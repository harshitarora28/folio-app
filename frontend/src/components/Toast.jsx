import { View, Text, TouchableOpacity, Animated, useRef } from 'react-native'
import { useMemo } from 'react'
import { useUIStore } from '../stores/uiStore'

const TYPE_STYLES = {
  info:    { container: 'bg-folio-elevated border-folio-border',         text: 'text-folio-light' },
  success: { container: 'bg-folio-success/15 border-folio-success/40',   text: 'text-folio-success' },
  error:   { container: 'bg-folio-error/10  border-folio-error/40',      text: 'text-folio-error' },
}

export default function Toast() {
  const { toasts, removeToast } = useUIStore()
  if (!toasts.length) return null

  return (
    <View
      className="absolute bottom-20 left-0 right-0 items-center gap-2 px-6"
      pointerEvents="box-none"
      style={{ zIndex: 9999 }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
      ))}
    </View>
  )
}

function ToastItem({ toast, onDismiss }) {
  const style = TYPE_STYLES[toast.type] ?? TYPE_STYLES.info

  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3 rounded-full border ${style.container}`}
      style={{ maxWidth: 320 }}
    >
      <Text className={`flex-1 text-xs font-medium ${style.text}`} numberOfLines={2}>
        {toast.message}
      </Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text className={`text-xs opacity-60 ${style.text}`}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}
