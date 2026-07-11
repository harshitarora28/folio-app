import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet, ScrollView, Clipboard, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useUIStore }     from '../stores/uiStore'
import { useReaderStore } from '../stores/readerStore'
import {
  useChatSessions, useChatMessages,
  useCreateSession, useDeleteSession, useSendMessage,
} from '../hooks/useChat'

// Long responses collapse after this many chars
const COLLAPSE_THRESHOLD = 300

export default function ChatScreen() {
  const nav   = useNavigation()
  const route = useRoute()
  const { book, prefill } = route.params ?? {}

  const inputRef = useRef()
  const listRef  = useRef()
  const [input, setInput] = useState(prefill ?? '')

  const { chatSidebarOpen, toggleChatSidebar, activeSessionId, setActiveSessionId } = useUIStore()
  const readerProgress = useReaderStore((s) => s.progress)

  const { data: sessions = [], isLoading: sessionsLoading } = useChatSessions(book?.id)
  const { data: messages = [], isLoading: msgsLoading }     = useChatMessages(activeSessionId)

  const createSession = useCreateSession(book?.id)
  const deleteSession = useDeleteSession(book?.id)
  const sendMessage   = useSendMessage(activeSessionId, book?.id)

  // Track expanded state per message id
  const [expandedMsgs, setExpandedMsgs]     = useState({})
  const [retryingId,   setRetryingId]       = useState(null) // id of AI msg being retried

  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions])

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120)
    }
  }, [messages.length, sendMessage.isPending])

  const handleNewSession = () => {
    const title = `Chat ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    createSession.mutate(title, {
      onSuccess: () => { setInput(''); inputRef.current?.focus() },
    })
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || sendMessage.isPending) return
    if (!activeSessionId) {
      createSession.mutate(text.slice(0, 40), {
        onSuccess: () => sendMessage.mutate(text),
      })
    } else {
      sendMessage.mutate(text)
    }
    setInput('')
  }

  const handleRetry = (userContent, aiMsgId) => {
    if (sendMessage.isPending) return
    // Mark this AI bubble as being retried, then resend the original user message
    setRetryingId(aiMsgId)
    sendMessage.mutate(userContent, {
      onSettled: () => setRetryingId(null),
    })
  }

  const handleCopy = (content) => {
    Clipboard.setString(content)
    Alert.alert('Copied', 'Message copied to clipboard', [{ text: 'OK' }], { cancelable: true })
  }

  const toggleExpand = (id) =>
    setExpandedMsgs(p => ({ ...p, [id]: !p[id] }))

  // Safe date formatter — handles ISO strings, timestamps, and undefined
  const formatTime = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const formatDate = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const renderMessage = ({ item: msg }) => {
    const isUser      = msg.role === 'user'
    const isLong      = msg.content.length > COLLAPSE_THRESHOLD
    const isExpanded  = !!expandedMsgs[msg.id]
    // Strip markdown bold/italic markers Gemini sometimes returns
    const cleanContent = msg.content
      .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
      .replace(/\*(.+?)\*/g, '$1')         // *italic* → italic
      .replace(/^#+\s+/gm, '')             // ## headings → plain
    const displayText = isLong && !isExpanded
      ? cleanContent.slice(0, COLLAPSE_THRESHOLD) + '…'
      : cleanContent
    const time = formatTime(msg.created_at)

    return (
      <View style={[st.msgRow, isUser && st.msgRowUser]}>
        {!isUser && (
          <View style={st.avatar}>
            <Text style={st.avatarText}>✦</Text>
          </View>
        )}
        <TouchableOpacity
          activeOpacity={0.85}
          onLongPress={() => {
            if(isUser){
              Alert.alert('Message', undefined, [
                { text: 'Copy',   onPress: () => handleCopy(msg.content) },
                { text: 'Retry',  onPress: () => handleRetry(msg.content, null) },
                { text: 'Cancel', style: 'cancel' },
              ], { cancelable: true })
            } else {
              // For AI bubble — find the preceding user message to retry
              const msgs = messages
              const idx  = msgs.findIndex(m => m.id === msg.id)
              const userMsg = idx > 0 ? msgs.slice(0,idx).reverse().find(m => m.role==='user') : null
              const options = [
                { text: 'Copy', onPress: () => handleCopy(msg.content) },
              ]
              if(userMsg){
                options.push({ text: 'Regenerate', onPress: () => handleRetry(userMsg.content, msg.id) })
              }
              options.push({ text: 'Cancel', style: 'cancel' })
              Alert.alert('Message', undefined, options, { cancelable: true })
            }
          }}
          style={[st.bubble, isUser ? st.bubbleUser : st.bubbleAI]}
        >
          {retryingId === msg.id ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
              <ActivityIndicator size="small" color="#E8A838" />
              <Text style={st.bubbleTextAI}>Regenerating…</Text>
            </View>
          ) : (
            <Text style={[st.bubbleText, isUser ? st.bubbleTextUser : st.bubbleTextAI]}>
              {displayText}
            </Text>
          )}

          {isLong && (
            <TouchableOpacity onPress={() => toggleExpand(msg.id)} style={st.expandBtn}>
              <Text style={st.expandBtnText}>
                {isExpanded ? '▲ Show less' : '▼ Show more'}
              </Text>
            </TouchableOpacity>
          )}

          {time !== '' && (
            <Text style={[st.timestamp, isUser ? st.timestampUser : st.timestampAI]}>
              {time}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <SafeAreaView style={st.root}>

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={st.headerBack}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={toggleChatSidebar} style={st.menuBtn}>
          {[0,1,2].map(i => <View key={i} style={st.menuLine} />)}
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.headerTitle}>AI Chat</Text>
          {book && <Text style={st.headerSub} numberOfLines={1}>{book.title}</Text>}
        </View>
        <TouchableOpacity
          style={st.newBtn}
          onPress={handleNewSession}
          disabled={createSession.isPending}
        >
          <Text style={st.newBtnText}>{createSession.isPending ? '…' : '＋ New'}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' }}>

        {/* Sidebar */}
        {chatSidebarOpen && (
          <View style={st.sidebar}>
            <View style={st.sidebarHeader}>
              <Text style={st.sidebarLabel}>CHATS</Text>
              <TouchableOpacity onPress={handleNewSession}>
                <Text style={st.sidebarAdd}>＋</Text>
              </TouchableOpacity>
            </View>
            {sessionsLoading ? (
              <View style={st.center}><ActivityIndicator color="#E8A838" size="small" /></View>
            ) : sessions.length === 0 ? (
              <View style={{ padding: 14 }}>
                <Text style={st.sidebarEmpty}>No chats yet.{'\n'}Start one below.</Text>
              </View>
            ) : (
              <FlatList
                data={sessions}
                keyExtractor={s => s.id}
                renderItem={({ item: s }) => (
                  <TouchableOpacity
                    style={[st.sessionRow, activeSessionId === s.id && st.sessionRowActive]}
                    onPress={() => { setActiveSessionId(s.id); toggleChatSidebar() }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={st.sessionTitle} numberOfLines={1}>{s.title || 'Untitled'}</Text>
                      {s.last_message && (
                        <Text style={st.sessionPreview} numberOfLines={1}>{s.last_message}</Text>
                      )}
                      <Text style={st.sessionDate}>{formatDate(s.created_at)}</Text>
                    </View>
                    <TouchableOpacity
                      style={{ padding: 8 }}
                      onPress={() => deleteSession.mutate(s.id)}
                    >
                      <Text style={st.sessionDelete}>✕</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}

        {/* Chat area */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 10}
        >
          {/* Empty state */}
          {!activeSessionId && !sessionsLoading && (
            <View style={st.emptyState}>
              <Text style={{ fontSize: 44 }}>💬</Text>
              <Text style={st.emptyTitle}>
                Chat about{'\n'}
                <Text style={st.emptyTitleAccent}>{book?.title ?? 'this book'}</Text>
              </Text>
              <Text style={st.emptySubtitle}>
                Ask questions, explore themes, get explanations.
                {readerProgress > 0 ? `\nYou're ${readerProgress}% through — no spoilers.` : ''}
              </Text>
              <View style={st.suggestedRow}>
                {['What are the major themes?', 'Explain the last chapter', 'Who are the key characters?'].map(q => (
                  <TouchableOpacity
                    key={q}
                    style={st.suggestedBtn}
                    onPress={() => { setInput(q); inputRef.current?.focus() }}
                  >
                    <Text style={st.suggestedText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Messages */}
          {msgsLoading && activeSessionId ? (
            <View style={st.center}><ActivityIndicator color="#E8A838" size="large" /></View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={m => m.id}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={() =>
                sendMessage.isPending ? (
                  <View style={st.msgRow}>
                    <View style={st.avatar}><Text style={st.avatarText}>✦</Text></View>
                    <View style={st.typingBubble}>
                      {[0,1,2].map(i => <View key={i} style={st.typingDot} />)}
                    </View>
                  </View>
                ) : null
              }
              renderItem={renderMessage}
            />
          )}

          {/* Input */}
          <View style={st.inputWrap}>
            <View style={st.inputRow}>
              <TextInput
                ref={inputRef}
                style={st.input}
                placeholder={activeSessionId ? 'Ask about the book…' : 'Start a new conversation…'}
                placeholderTextColor="#8A8070"
                value={input}
                onChangeText={setInput}
                onSubmitEditing={handleSend}
                multiline
                blurOnSubmit={false}
              />
              <TouchableOpacity
                style={[st.sendBtn, (!input.trim() || sendMessage.isPending) && st.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!input.trim() || sendMessage.isPending}
              >
                {sendMessage.isPending
                  ? <ActivityIndicator color="#0F0E0C" size="small" />
                  : <Text style={st.sendBtnText}>↑</Text>
                }
              </TouchableOpacity>
            </View>
            <Text style={st.inputHint}>Long press any message to copy · Long press your message to retry</Text>
          </View>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  )
}

const ACCENT = '#E8A838'
const BG     = '#0F0E0C'
const CARD   = '#1A1916'
const ELV    = '#242220'
const BORDER = '#2E2C28'
const TEXT   = '#F0EBE1'
const MUTED  = '#8A8070'
const LIGHT  = '#C8BFB0'

const st = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header:     { flexDirection: 'row', alignItems: 'center', padding: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  headerBack: { color: TEXT, fontSize: 22 },
  menuBtn:    { padding: 4, gap: 4, justifyContent: 'center' },
  menuLine:   { width: 16, height: 1.5, backgroundColor: MUTED, borderRadius: 1 },
  headerTitle:{ color: TEXT, fontSize: 16, fontFamily: 'Georgia' },
  headerSub:  { color: MUTED, fontSize: 11 },
  newBtn:     { backgroundColor: ACCENT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  newBtnText: { color: BG, fontSize: 12, fontWeight: '700' },

  sidebar:       { width: 200, backgroundColor: CARD, borderRightWidth: 1, borderRightColor: BORDER },
  sidebarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  sidebarLabel:  { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  sidebarAdd:    { color: ACCENT, fontSize: 18 },
  sidebarEmpty:  { color: MUTED, fontSize: 12, lineHeight: 18 },
  sessionRow:    { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  sessionRowActive: { backgroundColor: ELV, borderLeftWidth: 2, borderLeftColor: ACCENT },
  sessionTitle:  { color: TEXT, fontSize: 12, fontWeight: '500' },
  sessionPreview:{ color: MUTED, fontSize: 11, marginTop: 2 },
  sessionDate:   { color: MUTED, fontSize: 10, marginTop: 3 },
  sessionDelete: { color: MUTED, fontSize: 12 },

  emptyState:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle:       { color: TEXT, fontSize: 18, fontFamily: 'Georgia', textAlign: 'center', marginTop: 16, marginBottom: 8 },
  emptyTitleAccent: { color: ACCENT },
  emptySubtitle:    { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  suggestedRow:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  suggestedBtn:     { backgroundColor: ELV, borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  suggestedText:    { color: LIGHT, fontSize: 12 },

  // Message row
  msgRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUser: { flexDirection: 'row-reverse' },

  avatar:     { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(232,168,56,0.14)', borderWidth: 1, borderColor: 'rgba(232,168,56,0.3)', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 2 },
  avatarText: { color: ACCENT, fontSize: 10 },

  // Bubbles — 85% width so long responses aren't squished
  bubble:         { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser:     { backgroundColor: ACCENT, borderBottomRightRadius: 4 },
  bubbleAI:       { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderBottomLeftRadius: 4 },
  bubbleText:     { fontSize: 14, lineHeight: 22 },
  bubbleTextUser: { color: BG },
  bubbleTextAI:   { color: LIGHT },

  expandBtn:     { marginTop: 6 },
  expandBtnText: { color: ACCENT, fontSize: 11, fontWeight: '600' },

  timestamp:     { fontSize: 10, marginTop: 4 },
  timestampUser: { color: 'rgba(15,14,12,0.55)', textAlign: 'right' },
  timestampAI:   { color: MUTED },

  typingBubble: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', gap: 5, alignItems: 'center' },
  typingDot:    { width: 6, height: 6, backgroundColor: MUTED, borderRadius: 3 },

  inputWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: BORDER },
  inputRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: ELV, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingLeft: 14, paddingRight: 6, paddingVertical: 8 },
  input:     { flex: 1, color: TEXT, fontSize: 14, lineHeight: 20, maxHeight: 120 },
  sendBtn:   { width: 34, height: 34, borderRadius: 17, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnDisabled: { opacity: 0.35 },
  sendBtnText:    { color: BG, fontWeight: '700', fontSize: 16 },
  inputHint: { color: MUTED, fontSize: 10, textAlign: 'center', marginTop: 6 },
})
