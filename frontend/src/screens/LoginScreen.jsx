import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView,
} from 'react-native'
import { useSignIn, useSignUp, useOAuth } from '@clerk/clerk-expo'
import * as WebBrowser from 'expo-web-browser'
import * as api from '../services/api'
import { AntDesign, Feather } from '@expo/vector-icons'

WebBrowser.maybeCompleteAuthSession()

export default function LoginScreen() {
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn()
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp()
  const { startOAuthFlow: googleFlow } = useOAuth({ strategy: 'oauth_google' })
  const { startOAuthFlow: appleFlow  } = useOAuth({ strategy: 'oauth_apple'  })

  const [mode, setMode]           = useState('login')
  const [form, setForm]           = useState({ name: '', email: '', password: '' })
  const [verifying, setVerifying] = useState(false)
  const [code, setCode]           = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [needs2FA, setNeeds2FA]   = useState(false)
  const [totpCode, setTotpCode]   = useState('')

  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }))

  async function syncAfterAuth(name, email) {
    try { await api.syncUser({ name, email }) } catch {}
  }

  // ── Email / Password Login ─────────────────────────────────────────────────
  // Handles three possible statuses from Clerk:
  //   complete          → normal login, no extra verification needed
  //   needs_second_factor → user has MFA enabled on their account
  //   needs_client_trust  → Clerk's credential stuffing protection on new device
  //                         (sends email OTP automatically, same flow as MFA)
  async function handleEmailLogin() {
    if (!signInLoaded) return
    if (!form.email || !form.password) { setError('Please fill in all fields.'); return }
    setLoading(true); setError('')
    try {
      const result = await signIn.create({
        identifier: form.email,
        password:   form.password,
      })

      if (result.status === 'complete') {
        await setSignInActive({ session: result.createdSessionId })
        await syncAfterAuth(null, form.email)

      } else if (
        result.status === 'needs_second_factor' ||
        result.status === 'needs_client_trust'
      ) {
        // Find the email_code second factor — this is what Clerk uses for
        // both MFA and Client Trust (new device verification)
        const emailFactor = result.supportedSecondFactors?.find(
          (f) => f.strategy === 'email_code'
        )

        if (emailFactor) {
          // Prepare triggers Clerk to send the OTP email
          await signIn.prepareSecondFactor({
            strategy:       'email_code',
            emailAddressId: emailFactor.emailAddressId,
          })
          setNeeds2FA(true)
        } else {
          // Fallback: try preparing without emailAddressId (some Clerk configs)
          try {
            await signIn.prepareSecondFactor({ strategy: 'email_code' })
            setNeeds2FA(true)
          } catch {
            setError('A second verification step is required. Please try again or use Google sign-in.')
          }
        }
      }
    } catch (err) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  // ── 2FA / Client Trust verification ───────────────────────────────────────
  async function handle2FA() {
    if (!totpCode) { setError('Please enter your verification code.'); return }
    setLoading(true); setError('')
    try {
      const result = await signIn.attemptSecondFactor({
        strategy: 'email_code',
        code:     totpCode,
      })
      if (result.status === 'complete') {
        await setSignInActive({ session: result.createdSessionId })
        await syncAfterAuth(null, form.email)
        setNeeds2FA(false)
        setTotpCode('')
      } else {
        setError('Verification incomplete. Please try again.')
      }
    } catch (err) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Invalid code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Email / Password Register ──────────────────────────────────────────────
  async function handleEmailRegister() {
    if (!signUpLoaded) return
    if (!form.name || !form.email || !form.password) { setError('Please fill in all fields.'); return }
    setLoading(true); setError('')
    try {
      await signUp.create({
        firstName:    form.name.split(' ')[0],
        lastName:     form.name.split(' ').slice(1).join(' ') || '',
        emailAddress: form.email,
        password:     form.password,
      })
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      setVerifying(true)
    } catch (err) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  // ── Email signup verification ──────────────────────────────────────────────
  async function handleVerifyCode() {
    if (!signUpLoaded) return
    setLoading(true); setError('')
    try {
      const result = await signUp.attemptEmailAddressVerification({ code })
      if (result.status === 'complete') {
        await setSignUpActive({ session: result.createdSessionId })
        await syncAfterAuth(form.name, form.email)
      }
    } catch (err) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Invalid code.')
    } finally {
      setLoading(false)
    }
  }

  // ── Google OAuth ───────────────────────────────────────────────────────────
  async function handleGoogle() {
    setError('')
    try {
      const { createdSessionId, setActive, signUp: oauthSignUp } = await googleFlow()
      if (createdSessionId) {
        await setActive({ session: createdSessionId })
        const email = oauthSignUp?.emailAddress || ''
        const name  = [oauthSignUp?.firstName, oauthSignUp?.lastName].filter(Boolean).join(' ')
        await syncAfterAuth(name, email)
      }
    } catch (err) {
      if (!err.message?.includes('cancelled')) {
        setError('Google sign in failed. Please try again.')
      }
    }
  }

  // ── Apple OAuth ────────────────────────────────────────────────────────────
  async function handleApple() {
    setError('')
    try {
      const { createdSessionId, setActive, signUp: oauthSignUp } = await appleFlow()
      if (createdSessionId) {
        await setActive({ session: createdSessionId })
        const email = oauthSignUp?.emailAddress || ''
        const name  = [oauthSignUp?.firstName, oauthSignUp?.lastName].filter(Boolean).join(' ')
        await syncAfterAuth(name, email)
      }
    } catch (err) {
      if (!err.message?.includes('cancelled')) {
        setError('Apple sign in failed. Please try again.')
      }
    }
  }

  const handleSubmit = mode === 'login' ? handleEmailLogin : handleEmailRegister

  // ── 2FA / Client Trust screen ─────────────────────────────────────────────
  if (needs2FA) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-folio-bg"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center mb-10">
            <Text className="text-folio-accent text-5xl font-bold tracking-widest"
              style={{ fontFamily: 'Georgia' }}>Folio</Text>
            <Text className="text-folio-muted text-sm mt-2">Verify your identity</Text>
          </View>

          <View className="bg-folio-card border border-folio-border rounded-2xl p-6">
            <Text className="text-folio-text text-base text-center mb-2">
              We sent a 6-digit code to
            </Text>
            <Text className="text-folio-accent text-base text-center font-semibold mb-6">
              {form.email}
            </Text>

            <TextInput
              className="bg-folio-elevated border border-folio-border rounded-xl px-4 py-3 text-folio-text text-base mb-4 text-center tracking-widest"
              placeholder="000000"
              placeholderTextColor="#8A8070"
              value={totpCode}
              onChangeText={setTotpCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />

            {error !== '' && (
              <View className="bg-red-900/20 border border-folio-error rounded-lg px-3 py-2 mb-4">
                <Text className="text-folio-error text-sm">{error}</Text>
              </View>
            )}

            <TouchableOpacity
              className={`bg-folio-accent rounded-xl py-4 items-center ${loading ? 'opacity-60' : ''}`}
              onPress={handle2FA}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#0F0E0C" />
                : <Text className="text-folio-bg text-base font-bold">Verify</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              className="mt-4 items-center"
              onPress={() => { setNeeds2FA(false); setTotpCode(''); setError('') }}
            >
              <Text className="text-folio-muted text-sm">← Back to sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // ── Email verification screen (signup) ────────────────────────────────────
  if (verifying) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-folio-bg"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center mb-10">
            <Text className="text-folio-accent text-5xl font-bold tracking-widest"
              style={{ fontFamily: 'Georgia' }}>Folio</Text>
            <Text className="text-folio-muted text-sm mt-2">Verify your email</Text>
          </View>

          <View className="bg-folio-card border border-folio-border rounded-2xl p-6">
            <Text className="text-folio-text text-base text-center mb-2">
              We sent a 6-digit code to
            </Text>
            <Text className="text-folio-accent text-base text-center font-semibold mb-6">
              {form.email}
            </Text>

            <TextInput
              className="bg-folio-elevated border border-folio-border rounded-xl px-4 py-3 text-folio-text text-base mb-4 text-center tracking-widest"
              placeholder="000000"
              placeholderTextColor="#8A8070"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />

            {error !== '' && (
              <View className="bg-red-900/20 border border-folio-error rounded-lg px-3 py-2 mb-4">
                <Text className="text-folio-error text-sm">{error}</Text>
              </View>
            )}

            <TouchableOpacity
              className={`bg-folio-accent rounded-xl py-4 items-center ${loading ? 'opacity-60' : ''}`}
              onPress={handleVerifyCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#0F0E0C" />
                : <Text className="text-folio-bg text-base font-bold">Verify Email</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity className="mt-4 items-center" onPress={() => setVerifying(false)}>
              <Text className="text-folio-muted text-sm">← Back</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  // ── Main login / register screen ───────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-folio-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View className="items-center mb-10">
          <Text className="text-folio-accent text-5xl font-bold tracking-widest"
            style={{ fontFamily: 'Georgia' }}>
            Folio
          </Text>
          <Text className="text-folio-muted text-sm mt-2">
            Your AI reading companion
          </Text>
        </View>

        {/* Card */}
        <View className="bg-folio-card border border-folio-border rounded-2xl p-6">

          {/* Tabs */}
          <View className="flex-row bg-folio-elevated rounded-xl p-1 mb-5">
            {['login', 'register'].map((m) => (
              <TouchableOpacity
                key={m}
                className={`flex-1 py-2 rounded-xl items-center ${mode === m ? 'bg-folio-accent' : ''}`}
                onPress={() => { setMode(m); setError(''); setVerifying(false) }}
              >
                <Text className={`text-sm font-semibold ${mode === m ? 'text-folio-bg' : 'text-folio-muted'}`}>
                  {m === 'login' ? 'Sign In' : 'Register'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Name field — register only */}
          {mode === 'register' && (
            <TextInput
              className="bg-folio-elevated border border-folio-border rounded-xl px-4 py-3 text-folio-text text-base mb-3"
              placeholder="Full name"
              placeholderTextColor="#8A8070"
              value={form.name}
              onChangeText={set('name')}
              autoCapitalize="words"
            />
          )}

          <TextInput
            className="bg-folio-elevated border border-folio-border rounded-xl px-4 py-3 text-folio-text text-base mb-3"
            placeholder="Email"
            placeholderTextColor="#8A8070"
            value={form.email}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View className="relative mb-4 justify-center">
            <TextInput
              className="bg-folio-elevated border border-folio-border rounded-xl pl-4 pr-12 py-3 text-folio-text text-base"
              placeholder="Password"
              placeholderTextColor="#8A8070"
              value={form.password}
              onChangeText={set('password')}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              className="absolute right-4"
              onPress={() => setShowPassword(!showPassword)}
            >
              <Feather
                name={showPassword ? "eye" : "eye-off"}
                size={20}
                color="#8A8070"
              />
            </TouchableOpacity>
          </View>

          {error !== '' && (
            <View className="bg-red-900/20 border border-folio-error rounded-lg px-3 py-2 mb-4">
              <Text className="text-folio-error text-sm">{error}</Text>
            </View>
          )}

          {/* Primary button */}
          <TouchableOpacity
            className={`bg-folio-accent rounded-xl py-4 items-center mb-4 ${loading ? 'opacity-60' : ''}`}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#0F0E0C" />
              : <Text className="text-folio-bg text-base font-bold">
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                </Text>
            }
          </TouchableOpacity>

          {/* Divider */}
          <View className="flex-row items-center mb-4">
            <View className="flex-1 h-px bg-folio-border" />
            <Text className="text-folio-muted text-xs mx-3">or continue with</Text>
            <View className="flex-1 h-px bg-folio-border" />
          </View>

          {/* Social buttons */}
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={handleGoogle}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center',
                justifyContent: 'center', backgroundColor: '#ffffff',
                borderRadius: 12, paddingVertical: 12, gap: 8,
              }}
            >
              <AntDesign name="google" size={18} color="#4285F4" />
              <Text style={{ color: '#1a1a1a', fontSize: 13, fontWeight: '600' }}>Google</Text>
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity
                onPress={handleApple}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center',
                  justifyContent: 'center', backgroundColor: '#000000',
                  borderRadius: 12, paddingVertical: 12, gap: 8,
                }}
              >
                <AntDesign name="apple1" size={18} color="#ffffff" />
                <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Apple</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text className="text-folio-muted text-xs text-center mt-6 leading-5">
          Your books stay on your device.{'\n'}We only sync your progress.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
