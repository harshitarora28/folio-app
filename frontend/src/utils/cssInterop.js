// NativeWind v4 + React Native 0.76 New Architecture
// Register cssInterop for third-party components that use className
import { cssInterop } from 'nativewind'
import { ScrollView, FlatList } from 'react-native'

// ScrollView needs cssInterop for contentContainerClassName support in New Arch
cssInterop(ScrollView, {
  className:                  'style',
  contentContainerClassName:  'contentContainerStyle',
})

cssInterop(FlatList, {
  className:                  'style',
  contentContainerClassName:  'contentContainerStyle',
})
