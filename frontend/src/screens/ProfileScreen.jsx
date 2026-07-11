import {
  View, Text, TouchableOpacity, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useUser, useAuth } from '@clerk/clerk-expo'
import { useLibrary }        from '../hooks/useBooks'
import { useHighlightCount, useProfile } from '../hooks/useProfile'
import { queryClient }       from '../lib/queryClient'
import { initBookStore }     from '../utils/bookStore'

// ── Streak calculation ────────────────────────────────────────────────────────
function calcStreak(books) {
  if (!books?.length) return 0

  const readDates = new Set()
  for (const b of books) {
    const ts = b.lastReadAt || b.lastRead
    if (!ts) continue
    try {
      const d = new Date(ts)
      const dateStr = d.toLocaleDateString('en-CA')
      readDates.add(dateStr)
    } catch {}
  }

  if (readDates.size === 0) return 0

  let streak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const dateStr = d.toLocaleDateString('en-CA')

    if (readDates.has(dateStr)) {
      streak++
    } else {
      if (i === 0) continue
      break
    }
  }

  return streak
}

export default function ProfileScreen() {
  const nav    = useNavigation()
  const { user: clerkUser } = useUser()
  const { signOut } = useAuth()

  const { data: books = [] }  = useLibrary()
  const { data: hlData }      = useHighlightCount()
  const { data: profileData } = useProfile()

  const name  = (profileData?.name && profileData.name !== 'Reader')
    ? profileData.name
    : (clerkUser?.fullName || clerkUser?.firstName || 'Reader')
  const email   = profileData?.email ?? clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''
  const hlCount = hlData?.count ?? 0
  const streak  = calcStreak(books)

  const readBooks = books.filter(b => (b.progress ?? 0) > 0)

  const handleSignOut = async () => {
    queryClient.clear()
    initBookStore(null)
    await signOut()
  }

  const SETTINGS = [
    { icon: '🔔', label: 'Notifications' },
    { icon: '☁️', label: 'Cloud sync' },
    { icon: 'Aa', label: 'Font preferences', mono: true },
    { icon: '🔒', label: 'Privacy' },
  ]

  return (
    <SafeAreaView className="flex-1 bg-folio-bg">

      {/* Header */}
      <View className="flex-row items-center justify-between px-6 py-3.5 border-b border-folio-border">
        <TouchableOpacity onPress={() => nav.goBack()} className="w-9" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text className="text-folio-text text-xl">←</Text>
        </TouchableOpacity>
        <Text className="text-folio-text text-lg font-medium" style={{ fontFamily: 'Georgia' }}>Profile</Text>
        <View className="w-9" />
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>

        {/* ── TABLET CONSTRAINT: Responsive max-width without breaking mobile ── */}
        <View className="max-w-lg w-full self-center px-6">

          {/* Avatar + Identity */}
          <View className="items-center py-6">
            <View className="w-20 h-20 rounded-full bg-folio-accent/15 border border-folio-accent items-center justify-center mb-3 shadow-sm">
              <Text className="text-folio-accent text-3xl font-bold">
                {name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text className="text-folio-text text-xl font-semibold mb-1" style={{ fontFamily: 'Georgia' }}>{name}</Text>
            <Text className="text-folio-muted text-sm">{email}</Text>
          </View>

          {/* ── INDUSTRY STANDARD: Unified Grouped Stat Strip ── */}
          <View className="bg-folio-card border border-folio-border rounded-2xl py-4 flex-row items-center justify-between shadow-sm mb-3">
            <StatColumn value={books.length}     label="Books"      />
            <View className="w-[1px] h-8 bg-folio-border/80" />
            
            <StatColumn value={readBooks.length} label="Read"       />
            <View className="w-[1px] h-8 bg-folio-border/80" />
            
            <StatColumn value={hlCount}          label="Highlights" />
            <View className="w-[1px] h-8 bg-folio-border/80" />
            
            <StatColumn value={streak}           label="Streak 🔥"  accent={streak > 0} />
          </View>

          {/* Contextual Streak Subtitle */}
          <Text className="text-folio-muted text-xs text-center mb-6 font-medium">
            {streak > 0
              ? (streak === 1 ? 'You read today — keep the momentum going!' : `${streak} days in a row — don't break the chain!`)
              : 'Open any book today to start your reading streak.'}
          </Text>

          {/* Settings Group */}
          <Text className="text-folio-muted text-xs mb-2 uppercase tracking-wider font-semibold">
            Settings
          </Text>
          <View className="bg-folio-card border border-folio-border rounded-2xl overflow-hidden mb-8 shadow-sm">
            {SETTINGS.map((row, i) => (
              <TouchableOpacity
                key={row.label}
                className={`flex-row items-center px-4 py-4 gap-4 ${i < SETTINGS.length - 1 ? 'border-b border-folio-border/80' : ''}`}
                activeOpacity={0.7}
              >
                <Text
                  className="w-6 text-center text-base"
                  style={row.mono ? { fontFamily: 'Georgia', fontWeight: '700', fontSize: 13, color: '#C8BFB0' } : {}}
                >
                  {row.icon}
                </Text>
                <Text className="flex-1 text-folio-light text-sm font-medium">{row.label}</Text>
                <Text className="text-folio-muted text-lg leading-none">›</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Sign Out Action — Naturally sits above the fold */}
          <TouchableOpacity
            className="w-full border border-folio-error/40 bg-folio-error/5 rounded-2xl py-4 items-center justify-center transition-all"
            onPress={handleSignOut}
            activeOpacity={0.8}
          >
            <Text className="text-folio-error font-semibold text-sm tracking-wide">Sign Out</Text>
          </TouchableOpacity>

        </View>
        {/* ── END TABLET CONSTRAINT ── */}

      </ScrollView>
    </SafeAreaView>
  )
}

// ── SLEEK STAT COLUMN (Zero margins, pure flexbox division) ──
function StatColumn({ value, label, accent = false }) {
  return (
    <View className="flex-1 items-center justify-center px-1">
      <Text
        className="text-xl font-bold tracking-tight mb-0.5"
        style={{ fontFamily: 'Georgia', color: accent ? '#E8A838' : '#F0EBE1' }}
      >
        {value}
      </Text>
      <Text className="text-folio-muted text-xs font-medium text-center" numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}