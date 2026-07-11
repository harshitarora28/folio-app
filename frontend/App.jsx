import { useEffect }               from 'react'
import { View, ActivityIndicator } from 'react-native'
import { GestureHandlerRootView }  from 'react-native-gesture-handler'
import { SafeAreaProvider }        from 'react-native-safe-area-context'
import { StatusBar }               from 'expo-status-bar'
import { ClerkProvider, ClerkLoaded, useAuth, useUser } from '@clerk/clerk-expo'
import * as SecureStore            from 'expo-secure-store'
import { QueryClientProvider }     from '@tanstack/react-query'

import { queryClient }    from './src/lib/queryClient'
import Navigation         from './src/navigation'
import Toast              from './src/components/Toast'
import { setTokenGetter } from './src/services/api'
import { initBookStore }  from './src/utils/bookStore'
import * as api           from './src/services/api'

const tokenCache = {
  async getToken(key) {
    try { return await SecureStore.getItemAsync(key) } catch { return null }
  },
  async saveToken(key, value) {
    try { await SecureStore.setItemAsync(key, value) } catch {}
  },
  async clearToken(key) {
    try { await SecureStore.deleteItemAsync(key) } catch {}
  },
}

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env')

// ── TokenBridge — wires Clerk's getToken into axios interceptor ──────────────
function TokenBridge() {
  const { getToken } = useAuth()
  useEffect(() => {
    setTokenGetter(getToken)
  }, [getToken])
  return null
}

// ── UserSyncBridge — the fix for all three auth/data-isolation bugs ──────────
// Runs on every auth state transition. Three responsibilities:
//   1. Scope local book storage to the signed-in user (prevents library bleed)
//   2. Push accurate name+email from live Clerk data to our backend
//      (fixes wrong/empty name for both email and Google OAuth signups)
//   3. Wipe all cached queries on sign-out (prevents next user seeing
//      previous user's profile/books/shelves before their own data loads)
function UserSyncBridge() {
  const { isSignedIn, userId } = useAuth()
  const { user }                = useUser()   // correctly destructured — useUser()
                                                // returns { user, isLoaded, isSignedIn },
                                                // NOT the user object itself

  useEffect(() => {
    if (isSignedIn && userId && user) {
      // 1. Scope local AsyncStorage book library to this Clerk user
      initBookStore(userId)

      // 2. Sync correct profile data — read directly from Clerk's live user
      //    object instead of trusting whatever LoginScreen passed at signup time.
      //    This single source of truth fixes:
      //      - returning Google OAuth users (signUp object is null for them)
      //      - email/password signups that previously sent name: null
      const name = user.fullName
                || [user.firstName, user.lastName].filter(Boolean).join(' ')
                || user.username
                || ''
      const email = user.primaryEmailAddress?.emailAddress
                 || user.emailAddresses?.[0]?.emailAddress
                 || ''

      api.syncUser({ name, email }).catch((err) => {
        console.warn('[UserSync] syncUser failed:', err?.message)
      })

      // Refetch profile with the corrected data
      queryClient.invalidateQueries({ queryKey: ['profile'] })

    } else if (!isSignedIn) {
      // 3. Sign-out — clear every cached query so the next sign-in starts clean.
      //    Without this, ProfileScreen/HomeScreen briefly render with the
      //    PREVIOUS user's cached data before their own queries resolve.
      queryClient.clear()
      initBookStore(null)
    }
  }, [isSignedIn, userId, user?.id])

  return null
}

export default function App() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkLoaded>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <QueryClientProvider client={queryClient}>
              <TokenBridge />
              <UserSyncBridge />
              <StatusBar style="light" backgroundColor="#0F0E0C" />
              <Navigation />
              <Toast />
            </QueryClientProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ClerkLoaded>
    </ClerkProvider>
  )
}
