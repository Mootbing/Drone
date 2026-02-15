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

const Stack = createNativeStackNavigator();

export default function App() {
  useEffect(() => { loadReferencePhoto(); }, []);

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
            title: '',
            headerRight: () => (
              <TouchableOpacity
                onPress={() => navigation.navigate('Settings')}
                style={{ paddingHorizontal: 4, paddingVertical: 6 }}
              >
                <Text style={{ color: '#888', fontSize: 14, fontWeight: '600' }}>Settings</Text>
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
