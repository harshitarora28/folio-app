import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs'
import { useAuth } from '@clerk/clerk-expo'
import { View, Text, ActivityIndicator } from 'react-native'
import LoginScreen           from '../screens/LoginScreen'
import HomeScreen            from '../screens/HomeScreen'
import StoreScreen           from '../screens/StoreScreen'
import ReaderScreen          from '../screens/ReaderScreen'
import ChatScreen            from '../screens/ChatScreen'
import ProfileScreen         from '../screens/ProfileScreen'
import StoreBookDetailScreen from '../screens/StoreBookDetailScreen'

const Stack = createNativeStackNavigator()
const Tab   = createBottomTabNavigator()

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#161412',
          borderTopColor:  '#2E2C28',
          borderTopWidth:  1,
          paddingBottom:   8,
          paddingTop:      8,
          height:          64,
        },
        tabBarActiveTintColor:   '#E8A838',
        tabBarInactiveTintColor: '#8A8070',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Library',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📚</Text>,
        }}
      />
      <Tab.Screen
        name="Store"
        component={StoreScreen}
        options={{
          tabBarLabel: 'Store',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🛒</Text>,
        }}
      />
    </Tab.Navigator>
  )
}

export default function Navigation() {
  const { isSignedIn, isLoaded } = useAuth()

  // Wait for Clerk to rehydrate session from SecureStore before rendering
  // Prevents flash of login screen on app open for already-logged-in users
  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F0E0C', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#E8A838" size="large" />
      </View>
    )
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown:  false,
          contentStyle: { backgroundColor: '#0F0E0C' },
          animation:    'slide_from_right',
        }}
      >
        {isSignedIn ? (
          <>
            <Stack.Screen name="MainTabs"        component={MainTabs} />
            <Stack.Screen name="Reader"          component={ReaderScreen}
              options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="Chat"            component={ChatScreen} />
            <Stack.Screen name="Profile"         component={ProfileScreen}
              options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="StoreBookDetail" component={StoreBookDetailScreen}
              options={{ animation: 'slide_from_right' }} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
