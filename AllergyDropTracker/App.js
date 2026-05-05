import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import HomeScreen from './screens/HomeScreen';
import ScheduleScreen from './screens/ScheduleScreen';
import LogScreen from './screens/LogScreen';
import SettingsScreen from './screens/SettingsScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import { loadData } from './utils/storage';

const Tab = createBottomTabNavigator();
const THEME = '#4f8ef7';

function MainTabs() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            const icons = {
              Home: focused ? 'home' : 'home-outline',
              Schedule: focused ? 'calendar' : 'calendar-outline',
              Log: focused ? 'list' : 'list-outline',
              Settings: focused ? 'settings' : 'settings-outline',
            };
            return <Ionicons name={icons[route.name]} size={size} color={color} />;
          },
          tabBarActiveTintColor: THEME,
          tabBarInactiveTintColor: '#aaa',
          tabBarStyle: { borderTopColor: '#eee' },
          headerStyle: { backgroundColor: THEME },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Today' }} />
        <Tab.Screen name="Schedule" component={ScheduleScreen} />
        <Tab.Screen name="Log" component={LogScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    async function init() {
      // In dev mode, wipe storage on every reload so onboarding always runs fresh
      if (__DEV__) {
        await AsyncStorage.clear();
        console.log('[DEV] Storage cleared');
      }
      const data = await loadData();
      setOnboardingDone(!!data.onboardingComplete);
      setReady(true);
    }
    init();
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {onboardingDone
        ? <MainTabs />
        : <OnboardingScreen onComplete={() => setOnboardingDone(true)} />
      }
    </SafeAreaProvider>
  );
}
