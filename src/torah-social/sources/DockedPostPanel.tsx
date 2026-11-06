import {memo, useCallback, useMemo, useState} from 'react'
import {
  I18nManager,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native'
import {Gesture, GestureDetector} from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {RichText as RichTextAPI} from '@bsky/sdk/richtext'

import {useOpenComposer} from '#/lib/hooks/useOpenComposer'
import {POST_TOMBSTONE, usePostShadow} from '#/state/cache/post-shadow'
import {PreviewableUserAvatar} from '#/view/com/util/UserAvatar'
import {atoms as a, useTheme, web} from '#/alf'
import {
  ChevronBottom_Stroke2_Corner0_Rounded as ChevronDown,
  ChevronTop_Stroke2_Corner0_Rounded as ChevronUp,
} from '#/components/icons/Chevron'
import {PostControls} from '#/components/PostControls'
import {RichText} from '#/components/RichText'
import {Text} from '#/components/Typography'
import {app} from '#/lexicons'
import * as bsky from '#/types/bsky'

export const PEEK_HEIGHT = 104

export function DockedPostPanel({
  post: initialPost,
}: {
  post: app.bsky.feed.defs.PostView
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const {height: winHeight} = useWindowDimensions()
  const isRTL = I18nManager.isRTL

  const post = usePostShadow(initialPost)
  const isTombstone = post === POST_TOMBSTONE

  const record = useMemo<app.bsky.feed.post.Main | undefined>(() => {
    if (isTombstone) return undefined
    return bsky.matches(app.bsky.feed.post, post.record)
      ? post.record
      : undefined
  }, [post, isTombstone])

  const richText = useMemo(() => {
    if (!record?.text) return undefined
    return new RichTextAPI({
      text: record.text,
      facets: record.facets,
    })
  }, [record])

  const {openComposer} = useOpenComposer()
  const onPressReply = useCallback(() => {
    if (isTombstone || !record) return
    openComposer({
      replyTo: {
        uri: post.uri,
        cid: post.cid,
        text: record.text,
        author: post.author,
        langs: record.langs,
      },
      logContext: 'PostReply',
    })
  }, [openComposer, post, record, isTombstone])

  const collapsedHeight = PEEK_HEIGHT + insets.bottom
  const expandedHeight =
    Math.min(520, Math.max(340, winHeight * 0.65)) + insets.bottom

  const [expandedState, setExpandedState] = useState(false)
  const progress = useSharedValue(0)
  const startProgress = useSharedValue(0)

  const toggleExpand = useCallback(() => {
    const next = !expandedState
    setExpandedState(next)
    progress.set(
      withSpring(next ? 1 : 0, {
        damping: 24,
        stiffness: 220,
      }),
    )
  }, [expandedState, progress])

  const panGesture = useMemo(() => {
    return Gesture.Pan()
      .onStart(() => {
        'worklet'
        startProgress.set(progress.get())
      })
      .onUpdate(e => {
        'worklet'
        // Dragging UP (negative translateY) expands the panel (progress -> 1)
        // Dragging DOWN (positive translateY) collapses the panel (progress -> 0)
        const totalTravel = expandedHeight - collapsedHeight
        const delta = -e.translationY / totalTravel
        const next = Math.max(0, Math.min(1, startProgress.get() + delta))
        progress.set(next)
      })
      .onEnd(e => {
        'worklet'
        const current = progress.get()
        const velocity = -e.velocityY
        let shouldExpand = current > 0.5
        if (velocity > 400) shouldExpand = true
        if (velocity < -400) shouldExpand = false

        progress.set(
          withSpring(shouldExpand ? 1 : 0, {
            damping: 24,
            stiffness: 220,
          }),
        )
        runOnJS(setExpandedState)(shouldExpand)
      })
  }, [collapsedHeight, expandedHeight, progress, startProgress])

  const panelAnimatedStyle = useAnimatedStyle(() => {
    const currentHeight = interpolate(
      progress.get(),
      [0, 1],
      [collapsedHeight, expandedHeight],
    )
    return {
      height: currentHeight,
    }
  })

  if (isTombstone) {
    return (
      <View
        style={[
          a.absolute,
          a.w_full,
          a.p_md,
          a.border_t,
          t.atoms.border_contrast_low,
          t.atoms.bg,
          {
            bottom: 0,
            left: 0,
            right: 0,
            paddingBottom: insets.bottom + 8,
          },
        ]}>
        <Text style={[a.text_sm, t.atoms.text_contrast_medium, a.text_center]}>
          הפוסט המקורי נמחק.
        </Text>
      </View>
    )
  }

  const ChevronIcon = expandedState ? ChevronDown : ChevronUp

  return (
    <Animated.View
      testID="dockedPostPanel"
      style={[
        a.absolute,
        a.w_full,
        a.border_t,
        t.atoms.border_contrast_medium,
        {
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          backgroundColor: t.name === 'dark' ? '#1c1b18' : '#ffffff',
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          shadowColor: '#000',
          shadowOffset: {width: 0, height: -4},
          shadowOpacity: t.name === 'dark' ? 0.35 : 0.12,
          shadowRadius: 10,
          elevation: 12,
        },
        web({
          maxWidth: 680,
          left: '50%',
          transform: [{translateX: '-50%'}],
        }),
        panelAnimatedStyle,
      ]}>
      {/* Drag handle & header bar */}
      <GestureDetector gesture={panGesture}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expandedState ? 'צמצם פוסט מעוגן' : 'הרחב פוסט מעוגן'
          }
          accessibilityHint="לחיצה כפולה או גרירה פותחת או סוגרת את פרטי הפוסט"
          onPress={toggleExpand}
          style={[a.pt_xs, a.pb_2xs, a.align_center, a.w_full]}>
          <View
            style={[
              a.rounded_full,
              t.atoms.bg_contrast_200,
              {width: 40, height: 4, marginBottom: 6},
            ]}
          />
        </Pressable>
      </GestureDetector>

      {/* Main panel content */}
      <View style={[a.flex_1, a.px_lg, {paddingBottom: insets.bottom + 4}]}>
        {/* Post header row */}
        <View style={[a.flex_row, a.align_center, a.justify_between, a.pb_xs]}>
          <View style={[a.flex_row, a.align_center, a.gap_sm, a.flex_1]}>
            <PreviewableUserAvatar
              size={34}
              profile={post.author}
              moderation={undefined}
              type={post.author.associated?.labeler ? 'labeler' : 'user'}
            />
            <View style={[a.flex_1, a.justify_center]}>
              <Text
                numberOfLines={1}
                style={[
                  a.text_sm,
                  a.font_semi_bold,
                  {
                    textAlign: isRTL ? 'right' : 'left',
                    writingDirection: isRTL ? 'rtl' : 'ltr',
                  },
                ]}>
                {post.author.displayName || post.author.handle}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  a.text_xs,
                  t.atoms.text_contrast_medium,
                  {
                    textAlign: isRTL ? 'right' : 'left',
                    writingDirection: 'ltr',
                  },
                ]}>
                @{post.author.handle}
              </Text>
            </View>
          </View>

          {/* Expand/Collapse toggle button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expandedState ? 'צמצם פוסט' : 'הרחב פוסט'}
            accessibilityHint="משנה את גודל תצוגת הפוסט המעוגן"
            onPress={toggleExpand}
            style={({pressed}) => [
              a.p_xs,
              a.rounded_full,
              t.atoms.bg_contrast_50,
              {opacity: pressed ? 0.7 : 1},
            ]}>
            <ChevronIcon size="sm" style={t.atoms.text_contrast_medium} />
          </Pressable>
        </View>

        {/* State A: Collapsed peek view */}
        {!expandedState && richText?.text ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="הרחב פוסט"
            accessibilityHint="מציג את תוכן הפוסט המלא"
            onPress={toggleExpand}
            style={[a.pt_2xs]}>
            <Text
              numberOfLines={2}
              style={[
                a.text_sm,
                a.leading_snug,
                t.atoms.text_contrast_high,
                {
                  textAlign: isRTL ? 'right' : 'left',
                  writingDirection: isRTL ? 'rtl' : 'ltr',
                },
              ]}>
              {richText.text}
            </Text>
          </Pressable>
        ) : null}

        {/* State B: Expanded view */}
        {expandedState && (
          <View style={[a.flex_1, a.pt_xs]}>
            <ScrollView
              showsVerticalScrollIndicator={true}
              style={[a.flex_1, a.mb_xs]}
              contentContainerStyle={[a.pb_sm]}>
              {richText?.text ? (
                <RichText
                  enableTags
                  value={richText}
                  style={[
                    a.text_md,
                    a.leading_normal,
                    {
                      textAlign: isRTL ? 'right' : 'left',
                      writingDirection: isRTL ? 'rtl' : 'ltr',
                    },
                  ]}
                  authorHandle={post.author.handle}
                  shouldProxyLinks={true}
                />
              ) : null}
            </ScrollView>

            {/* Social actions bar */}
            {record ? (
              <View style={[a.pt_xs, a.border_t, t.atoms.border_contrast_low]}>
                <PostControls
                  variant="compact"
                  post={post}
                  record={record}
                  richText={richText || new RichTextAPI({text: ''})}
                  onPressReply={onPressReply}
                  logContext="Post"
                />
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Animated.View>
  )
}

export default memo(DockedPostPanel)
