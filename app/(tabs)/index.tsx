import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import mqtt from 'mqtt';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

// Polyfills for MQTT in React Native
import 'react-native-get-random-values';
global.Buffer = Buffer;
global.process = require('process');

export default function App() {
  const [count, setCount] = useState(0);
  const [clientID, setClientID] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [heartbeatInterval, setHeartbeatInterval] = useState<number | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastDisconnectTime, setLastDisconnectTime] = useState<string | null>(null);

  // Function to clear all stored data
  const clearStoredData = async () => {
    try {
      await AsyncStorage.multiRemove(['client_id', 'mqtt_count', 'last_updated']);
      console.log('All stored data cleared');
      // Generate new client ID
      const newId = uuidv4().slice(0, 8);
      await AsyncStorage.setItem('client_id', newId);
      setClientID(newId);
      setCount(0);
      setLastUpdated(null);
      setReconnectAttempts(0);
      setLastDisconnectTime(null);
    } catch (error) {
      console.log('Error clearing data:', error);
    }
  };

  // Load or generate clientID and load saved count
  useEffect(() => {
    const loadClientID = async () => {
      let id = await AsyncStorage.getItem('client_id');
      if (!id) {
        id = uuidv4().slice(0, 8);
        await AsyncStorage.setItem('client_id', id);
      }
      setClientID(id);
      
      // Load saved count value
      const savedCount = await AsyncStorage.getItem('mqtt_count');
      if (savedCount) {
        const parsedCount = parseInt(savedCount);
        if (!isNaN(parsedCount)) {
          setCount(parsedCount);
          console.log('Loaded saved count from storage:', parsedCount);
        }
      }
      
      // Load last updated timestamp
      const lastUpdatedTime = await AsyncStorage.getItem('last_updated');
      if (lastUpdatedTime) {
        setLastUpdated(lastUpdatedTime);
        console.log('Loaded last updated time:', lastUpdatedTime);
      }
    };
    loadClientID();
  }, []);

  const sendStatusUpdate = (clientInstance: mqtt.MqttClient, id: string) => {
    const payload = {
      client_id: id,
      timestamp: new Date().toISOString(),
      count: count,
      status: isConnected ? 'online' : 'offline'
    };
    clientInstance.publish('clients/status', JSON.stringify(payload));
    console.log('Sent status update to server:', payload);
  };

  const startHeartbeat = (clientInstance: mqtt.MqttClient, id: string) => {
    // Clear existing heartbeat if any
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    
    // Send heartbeat every 15 seconds (half of server's 30-second threshold)
    const interval = setInterval(() => {
      if (clientInstance.connected) {
        sendStatusUpdate(clientInstance, id);
      }
    }, 15000);
    
    setHeartbeatInterval(interval);
    console.log('Started heartbeat every 15 seconds');
  };

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      setHeartbeatInterval(null);
      console.log('Stopped heartbeat');
    }
  };

  useEffect(() => {
    if (!clientID) return;
    
    setIsConnecting(true);
    setConnectionMessage('กำลังเชื่อมต่อ...');
    
    const client = mqtt.connect('ws://192.168.149.148:8083/mqtt', {
      clientId: clientID,
      reconnectPeriod: 5000, // Reconnect every 5 seconds
      connectTimeout: 10000, // Connection timeout (10 seconds)
    });
    
    const topic = `client/${clientID}/count`;
    const changeIdTopic = `client/${clientID}/change_id`;
    const getCountTopic = `client/${clientID}/get_count`;

    client.on('connect', () => {
      console.log('MQTT connected successfully');
      console.log('Connection details:', {
        clientId: clientID,
        broker: '192.168.149.148:8083',
        protocol: 'ws',
        timestamp: new Date().toISOString()
      });
      setIsConnected(true);
      setIsConnecting(false);
      sendStatusUpdate(client, clientID);
      startHeartbeat(client, clientID);
      setConnectionMessage('เชื่อมต่อ MQTT สำเร็จ!');
      setReconnectAttempts(0);
      
      // Subscribe to count updates
      client.subscribe(topic, (err) => {
        if (!err) {
          console.log(`Successfully subscribed to topic: ${topic}`);
        } else {
          console.log(`Failed to subscribe to topic: ${topic}`, err);
        }
      });
      
      // Subscribe for client ID change requests from server
      client.subscribe(changeIdTopic, (err) => {
        if (!err) {
          console.log(`Subscribed to changeIdTopic: ${changeIdTopic}`);
        }
      });
      
      // Subscribe for get count requests from server
      client.subscribe(getCountTopic, (err) => {
        if (!err) {
          console.log(`Subscribed to getCountTopic: ${getCountTopic}`);
        }
      });
    });

    client.on('reconnect', () => {
      console.log('Attempting to reconnect to MQTT...');
      setIsConnecting(true);
      setConnectionMessage(`กำลังพยายามเชื่อมต่อใหม่... (${reconnectAttempts + 1})`);
      setReconnectAttempts(prev => prev + 1);
    });

    client.on('error', (err) => {
      console.log('MQTT connection error:', err);
      console.log('Error details:', {
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
      setIsConnected(false);
      setIsConnecting(false);
      
      const errorCode = (err as any).code;
      const errorReason = errorCode === 'ENOTFOUND' ? 'ไม่พบเซิร์ฟเวอร์' : 
                         errorCode === 'ECONNREFUSED' ? 'เซิร์ฟเวอร์ปฏิเสธการเชื่อมต่อ' :
                         errorCode === 'ETIMEDOUT' ? 'การเชื่อมต่อหมดเวลา' :
                         errorCode === 'ECONNRESET' ? 'การเชื่อมต่อถูกรีเซ็ต' :
                         err.message ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
      setConnectionMessage(`เชื่อมต่อ MQTT ไม่สำเร็จ: ${errorReason}`);
    });

    client.on('close', () => {
      console.log('MQTT disconnected');
      setIsConnected(false);
      setIsConnecting(false);
      stopHeartbeat();
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: การเชื่อมต่อถูกปิด');
      setLastDisconnectTime(new Date().toISOString());
    });

    client.on('offline', () => {
      console.log('MQTT client is offline');
      setIsConnected(false);
      setIsConnecting(false);
      stopHeartbeat();
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: อุปกรณ์ออฟไลน์');
      setLastDisconnectTime(new Date().toISOString());
    });

    client.on('disconnect', () => {
      console.log('MQTT client disconnected');
      setIsConnected(false);
      setIsConnecting(false);
      stopHeartbeat();
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: ถูกตัดการเชื่อมต่อ');
      setLastDisconnectTime(new Date().toISOString());
    });

    client.on('message', async (topic, message) => {
      console.log(`Received message on topic: ${topic}`);
      console.log(`Message content: ${message.toString()}`);
      
      // Handle client ID change request from server
      if (topic.endsWith('/change_id')) {
        try {
          const changeRequest = JSON.parse(message.toString());
          const newClientID = changeRequest.new_client_id;
          
          if (newClientID && newClientID !== clientID) {
            console.log('Received client ID change request from server:', newClientID);
            
            // Update client ID in storage and state
            await AsyncStorage.setItem('client_id', newClientID);
            const oldClientID = clientID;
            setClientID(newClientID);
            
            // Send confirmation back to server
            const response = {
              old_client_id: oldClientID,
              new_client_id: newClientID,
              status: 'success',
              timestamp: new Date().toISOString()
            };
            
            client.publish('clients/change_id_response', JSON.stringify(response));
            console.log('Client ID changed successfully:', oldClientID, '->', newClientID);
            setConnectionMessage(`Client ID เปลี่ยนเป็น: ${newClientID}`);
          }
        } catch (error) {
          console.log('Error processing client ID change request:', error);
          const response = {
            old_client_id: clientID,
            new_client_id: null,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
          client.publish('clients/change_id_response', JSON.stringify(response));
        }
      }
      // Handle get count request from server
      else if (topic.endsWith('/get_count')) {
        console.log('Received get count request from server');
        const response = {
          client_id: clientID,
          count: count,
          timestamp: new Date().toISOString()
        };
        client.publish('clients/get_count_response', JSON.stringify(response));
        console.log('Sent current count to server:', count);
      }
      // Handle count updates
      else if (topic.endsWith('/count')) {
        try {
          const val = parseInt(message.toString());
          if (!isNaN(val)) {
            setCount(val);
            // Save count value and timestamp to AsyncStorage
            const timestamp = new Date().toISOString();
            await AsyncStorage.multiSet([
              ['mqtt_count', val.toString()],
              ['last_updated', timestamp]
            ]);
            setLastUpdated(timestamp);
            console.log('Successfully parsed and saved count value:', val, 'at', timestamp);
            
            // Send acknowledgment back to server
            const ack = {
              client_id: clientID,
              count: val,
              timestamp: timestamp
            };
            client.publish('clients/count_ack', JSON.stringify(ack));
            console.log('Sent count acknowledgment to server');
            
            // Send immediate status update to keep server informed
            sendStatusUpdate(client, clientID);
          } else {
            console.log('Message is not a valid number');
          }
        } catch (e) {
          console.log('Invalid message format:', e);
        }
      }
    });

    return () => {
      // Stop heartbeat first
      stopHeartbeat();
      // Send disconnect notification to server
      if (client.connected) {
        client.publish('clients/disconnected', clientID);
      }
      client.end();
    };
  }, [clientID]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.appTitle}>MQTT Reconnect Demo</Text>
        <Text style={styles.subtitle}>การจัดการการเชื่อมต่อ MQTT</Text>
      </View>
      
      <View style={styles.card}>
        <View style={styles.clientInfo}>
          <Text style={styles.label}>Client ID</Text>
          <Text style={styles.clientId}>{clientID || '...'}</Text>
          {isConnected && heartbeatInterval && (
            <Text style={styles.heartbeatStatus}>
              💓 Heartbeat Active
            </Text>
          )}
        </View>
        
        {connectionMessage && (
          <View style={[styles.statusCard, isConnected ? styles.statusSuccess : isConnecting ? styles.statusWarning : styles.statusError]}>
            <View style={styles.statusIndicator}>
              {isConnecting ? (
                <ActivityIndicator color="#3b82f6" size="small" style={styles.connectingIndicator} />
              ) : (
                <View style={[styles.statusDot, isConnected ? styles.dotConnected : styles.dotDisconnected]} />
              )}
              <Text style={[styles.statusMessage, isConnected ? styles.connected : isConnecting ? styles.connecting : styles.disconnected]}>
                {connectionMessage}
              </Text>
            </View>
          </View>
        )}
        
        <View style={styles.connectionStats}>
          <Text style={styles.statsLabel}>การเชื่อมต่อปัจจุบัน:</Text>
          <Text style={styles.statsValue}>
            {isConnected ? 'เชื่อมต่ออยู่' : isConnecting ? 'กำลังเชื่อมต่อ...' : 'ตัดการเชื่อมต่อ'}
          </Text>
          
          <Text style={styles.statsLabel}>ความพยายามเชื่อมต่อล่าสุด:</Text>
          <Text style={styles.statsValue}>{reconnectAttempts} ครั้ง</Text>
          
          {lastDisconnectTime && (
            <>
              <Text style={styles.statsLabel}>ตัดการเชื่อมต่อล่าสุด:</Text>
              <Text style={styles.statsValue}>{new Date(lastDisconnectTime).toLocaleTimeString()}</Text>
            </>
          )}
        </View>
        
        <View style={styles.countSection}>
          <Text style={styles.countLabel}>ค่า Count ปัจจุบัน</Text>
          <View style={styles.countContainer}>
            <Text style={styles.count}>{count}</Text>
          </View>
          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              อัปเดตล่าสุด: {new Date(lastUpdated).toLocaleString()}
            </Text>
          )}
        </View>
        
        <TouchableOpacity style={styles.resetButton} onPress={clearStoredData}>
          <Text style={styles.resetButtonText}>รีเซ็ตข้อมูลทั้งหมด</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>การทำงานของระบบ MQTT Reconnect</Text>
        <Text style={styles.infoText}>
          • ระบบจะพยายามเชื่อมต่อใหม่ทุก 5 วินาทีเมื่อการเชื่อมต่อขาดหาย
        </Text>
        <Text style={styles.infoText}>
          • Heartbeat จะส่งข้อมูลทุก 15 วินาทีเพื่อให้เซิร์ฟเวอร์ทราบสถานะ
        </Text>
        <Text style={styles.infoText}>
          • ระบบจะบันทึกจำนวนครั้งที่พยายามเชื่อมต่อใหม่
        </Text>
      </View>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f9ff',
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0c4a6e',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#0284c7',
    fontWeight: '500',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 4,
    shadowColor: '#0284c7',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  clientInfo: {
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0f2fe',
  },
  label: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  clientId: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0369a1',
    fontFamily: 'monospace',
  },
  heartbeatStatus: {
    fontSize: 12,
    color: '#10b981',
    marginTop: 6,
    fontWeight: '600',
  },
  statusCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  statusSuccess: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  statusWarning: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  statusError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  connectingIndicator: {
    marginRight: 10,
  },
  dotConnected: {
    backgroundColor: '#22c55e',
  },
  dotDisconnected: {
    backgroundColor: '#ef4444',
  },
  statusMessage: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  connected: {
    color: '#16a34a',
  },
  connecting: {
    color: '#ea580c',
  },
  disconnected: {
    color: '#dc2626',
  },
  connectionStats: {
    backgroundColor: '#e0f2fe',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  statsLabel: {
    fontSize: 13,
    color: '#0c4a6e',
    fontWeight: '600',
    marginBottom: 4,
  },
  statsValue: {
    fontSize: 15,
    color: '#0369a1',
    fontWeight: '600',
    marginBottom: 12,
  },
  countSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  countLabel: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  countContainer: {
    backgroundColor: '#f0f9ff',
    borderRadius: 16,
    padding: 24,
    minWidth: width * 0.4,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#bae6fd',
  },
  count: {
    fontSize: 64,
    fontWeight: 'bold',
    color: '#0284c7',
  },
  lastUpdated: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
    textAlign: 'center',
  },
  resetButton: {
    backgroundColor: '#f87171',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  resetButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  infoBox: {
    backgroundColor: '#dbeafe',
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e40af',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#1e40af',
    marginBottom: 8,
    lineHeight: 20,
  },
});