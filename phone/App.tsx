/**
 * Drone Control — Root component with navigation setup.
 */

import React, { useEffect } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import InputScreen from './src/screens/InputScreen';
import WatchScreen from './src/screens/WatchScreen';
import DeliveryScreen from './src/screens/DeliveryScreen';
import SettingsScreen, { loadReferencePhoto } from './src/screens/SettingsScreen';
import ActionRecorderScreen, { loadActionPoints } from './src/screens/ActionRecorderScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  useEffect(() => { loadReferencePhoto(); loadActionPoints(); }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Input"
        screenOptions={{
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="Input"
          component={InputScreen}
          options={({ navigation }) => ({
            title: 'SkyHeart',
            headerTitleStyle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.navigate('Settings')}
                style={{ paddingHorizontal: 4, paddingVertical: 6 }}
              >
                <Text style={{ color: '#888', fontSize: 20 }}>{'\u2699'}</Text>
              </TouchableOpacity>
            ),
          })}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
        <Stack.Screen
          name="ActionRecorder"
          component={ActionRecorderScreen}
          options={{ title: 'Action Recorder' }}
        />
        <Stack.Screen
          name="Watch"
          component={WatchScreen}
          options={{
            title: 'Flight Control',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="Delivery"
          component={DeliveryScreen}
          options={{
            title: 'Delivery',
            headerShown: false,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
