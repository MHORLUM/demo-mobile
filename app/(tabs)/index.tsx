import { Buffer } from 'buffer';
import mqtt from 'mqtt';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

// Polyfills for MQTT in React Native
import 'react-native-get-random-values';
global.Buffer = Buffer;
global.process = require('process');

export default function App() {
  const [count, setCount] = useState(0);
  const [clientID] = useState(() => uuidv4().slice(0, 8));
  const [isConnected, setIsConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');

  const sendStatusUpdate = (clientInstance: mqtt.MqttClient) => {
  const payload = {
    client_id: clientID,
    timestamp: new Date().toISOString(),
    count: count,
  };
  clientInstance.publish('clients/status', JSON.stringify(payload));
};

  useEffect(() => {
    const client = mqtt.connect('ws://192.168.149.148:8083/mqtt', {
      clientId: clientID,
    });

    const topic = `client/${clientID}/count`;

    client.on('connect', () => {
      console.log('MQTT connected successfully');
      console.log('Connection details:', {
        clientId: clientID,
        broker: '192.168.149.148:8083',
        protocol: 'ws',
        timestamp: new Date().toISOString()
      });
      setIsConnected(true);
      sendStatusUpdate(client);
      setConnectionMessage('เชื่อมต่อ MQTT สำเร็จ!');
      
      client.subscribe(topic, (err) => {
        if (!err) {
          console.log(`Successfully subscribed to topic: ${topic}`);
        } else {
          console.log(`Failed to subscribe to topic: ${topic}`, err);
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
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: การเชื่อมต่อถูกปิด');
    });

    client.on('offline', () => {
      console.log('MQTT client is offline');
      setIsConnected(false);
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: อุปกรณ์ออฟไลน์');
    });

    client.on('disconnect', () => {
      console.log('MQTT client disconnected');
      setIsConnected(false);
      setConnectionMessage('การเชื่อมต่อ MQTT ขาดหาย: ถูกตัดการเชื่อมต่อ');
    });

    client.on('message', (topic, message) => {
      console.log(`Received message on topic: ${topic}`);
      console.log(`Message content: ${message.toString()}`);
      try {
        const val = parseInt(message.toString());
        if (!isNaN(val)) {
          console.log(`Successfully parsed count value: ${val}`);
          setCount(val);
        } else {
          console.log('Message is not a valid number');
        }
      } catch (e) {
        console.log('Invalid message format:', e);
      }
    });

    return () => {
      client.end();
    };
  }, [clientID]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Client ID: {clientID}</Text>
      {connectionMessage && (
        <Text style={[styles.statusMessage, isConnected ? styles.connected : styles.disconnected]}>
          {connectionMessage}
        </Text>
      )}
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f4f8',
  },
  title: {
    fontSize: 20,
    marginBottom: 20,
    color: '#333',
  },
  statusMessage: {
    fontSize: 16,
    marginBottom: 15,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  connected: {
    color: '#28a745',
  },
  disconnected: {
    color: '#dc3545',
  },
  count: {
    fontSize: 80,
    fontWeight: 'bold',
    color: '#007aff',
  },
});
