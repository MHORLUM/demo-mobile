import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import mqtt from 'mqtt';
import React, { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

// Polyfills for MQTT in React Native
import 'react-native-get-random-values';
global.Buffer = Buffer;
global.process = require('process');

export default function App() {
  const [count, setCount] = useState(0);
  const [clientID, setClientID] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [heartbeatInterval, setHeartbeatInterval] = useState<number | null>(null);

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
    const client = mqtt.connect('ws://192.168.149.148:8083/mqtt', {
      clientId: clientID,
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
      sendStatusUpdate(client, clientID);
      startHeartbeat(client, clientID);
      setConnectionMessage('เชื่อมต่อ MQTT สำเร็จ!');
      
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

    client.on('error', (err) => {
      console.log('MQTT connection error:', err);
      console.log('Error details:', {
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
      setIsConnected(false);
      
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
      stopHeartbeat();
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: การเชื่อมต่อถูกปิด');
    });

    client.on('offline', () => {
      console.log('MQTT client is offline');
      setIsConnected(false);
      stopHeartbeat();
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: อุปกรณ์ออฟไลน์');
    });

    client.on('disconnect', () => {
      console.log('MQTT client disconnected');
      setIsConnected(false);
      stopHeartbeat();
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: ถูกตัดการเชื่อมต่อ');
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
        <Text style={styles.appTitle}>MQTT Counter</Text>
        <Text style={styles.subtitle}>Real-time Data Dashboard</Text>
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
          <View style={[styles.statusCard, isConnected ? styles.statusSuccess : styles.statusError]}>
            <View style={styles.statusIndicator}>
              <View style={[styles.statusDot, isConnected ? styles.dotConnected : styles.dotDisconnected]} />
              <Text style={[styles.statusMessage, isConnected ? styles.connected : styles.disconnected]}>
                {connectionMessage}
              </Text>
            </View>
          </View>
        )}
        
        <View style={styles.countSection}>
          <Text style={styles.countLabel}>Current Count</Text>
          <View style={styles.countContainer}>
            <Text style={styles.count}>{count}</Text>
          </View>
          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              Last updated: {new Date(lastUpdated).toLocaleString()}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  appTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  clientInfo: {
    alignItems: 'center',
    marginBottom: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3b82f6',
    fontFamily: 'monospace',
  },
  heartbeatStatus: {
    fontSize: 12,
    color: '#10b981',
    marginTop: 4,
    fontWeight: '600',
  },
  statusCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  statusSuccess: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  statusError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
    textAlign: 'center',
    flex: 1,
  },
  connected: {
    color: '#16a34a',
  },
  disconnected: {
    color: '#dc2626',
  },
  countSection: {
    alignItems: 'center',
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
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 24,
    minWidth: width * 0.4,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  count: {
    fontSize: 64,
    fontWeight: 'bold',
    color: '#3b82f6',
  },
  lastUpdated: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
    textAlign: 'center',
  },
  title: {
    fontSize: 20,
    marginBottom: 20,
    color: '#333',
  },
});
