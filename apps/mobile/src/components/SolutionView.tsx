import { CircleAlert, Images, Radio } from 'lucide-react-native'
import Markdown from 'react-native-markdown-display'
import { StyleSheet, Text, View } from 'react-native'

import type { RequestStatus, SessionState } from '../sync/session-reducer'

const requestStatusText: Record<RequestStatus, string> = {
  idle: '空闲',
  loading: '解题中',
  completed: '已完成',
  stopped: '已停止',
  failed: '失败'
}

type SolutionViewProps = {
  session: SessionState
}

export function SolutionView({ session }: SolutionViewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.metadata}>
        <View style={styles.metric}>
          <Images color="#718096" size={15} strokeWidth={1.8} />
          <Text style={styles.metricLabel}>截图</Text>
          <Text style={styles.metricValue}>{session.screenshotTotal}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.metric}>
          <Radio color={session.requestStatus === 'loading' ? '#3dd6a4' : '#718096'} size={15} />
          <Text style={styles.metricLabel}>请求</Text>
          <Text style={styles.metricValue}>{requestStatusText[session.requestStatus]}</Text>
        </View>
      </View>

      {session.protocolError ? (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <CircleAlert color="#ff8d86" size={17} />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>协议错误</Text>
            <Text style={styles.errorText}>{session.protocolError}</Text>
          </View>
        </View>
      ) : null}

      {session.errorMessage ? (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <CircleAlert color="#ff8d86" size={17} />
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>请求失败</Text>
            <Text style={styles.errorText}>{session.errorMessage}</Text>
          </View>
        </View>
      ) : null}

      <View
        style={[styles.solution, styles.solutionContent, !session.solution && styles.emptyContent]}
      >
        {session.solution ? (
          <Markdown style={markdownStyles}>{session.solution}</Markdown>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyLine} />
            <Text style={styles.emptyTitle}>等待解题结果</Text>
            <Text style={styles.emptyDescription}>连接桌面端后，答案会在此实时同步。</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    minHeight: 320
  },
  metadata: {
    alignItems: 'center',
    borderBottomColor: '#202a39',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 42,
    paddingHorizontal: 18
  },
  metric: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6
  },
  metricLabel: {
    color: '#718096',
    fontSize: 12
  },
  metricValue: {
    color: '#cbd5e1',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '600'
  },
  divider: {
    backgroundColor: '#263142',
    height: 14,
    marginHorizontal: 13,
    width: StyleSheet.hairlineWidth
  },
  errorBanner: {
    alignItems: 'flex-start',
    backgroundColor: '#241719',
    borderBottomColor: '#5c2a2e',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 11
  },
  errorCopy: {
    flex: 1,
    gap: 2
  },
  errorTitle: {
    color: '#ffaaa5',
    fontSize: 12,
    fontWeight: '700'
  },
  errorText: {
    color: '#d98d89',
    fontSize: 12,
    lineHeight: 18
  },
  solution: {
    flexGrow: 1
  },
  solutionContent: {
    paddingHorizontal: 18,
    paddingVertical: 18
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center'
  },
  emptyState: {
    alignItems: 'flex-start',
    marginBottom: 28
  },
  emptyLine: {
    backgroundColor: '#3dd6a4',
    height: 2,
    marginBottom: 16,
    width: 32
  },
  emptyTitle: {
    color: '#cbd5e1',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0
  },
  emptyDescription: {
    color: '#65758b',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7
  }
})

const markdownStyles = StyleSheet.create({
  body: {
    color: '#d6dee8',
    fontSize: 15,
    lineHeight: 24
  },
  heading1: {
    borderBottomColor: '#2b3748',
    borderBottomWidth: StyleSheet.hairlineWidth,
    color: '#f2f6fa',
    fontSize: 23,
    fontWeight: '700',
    marginBottom: 12,
    paddingBottom: 8
  },
  heading2: {
    color: '#e7edf4',
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 18
  },
  heading3: {
    color: '#e7edf4',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 14
  },
  paragraph: {
    marginBottom: 12,
    marginTop: 0
  },
  link: {
    color: '#55ddb0'
  },
  bullet_list: {
    marginBottom: 10
  },
  ordered_list: {
    marginBottom: 10
  },
  blockquote: {
    backgroundColor: '#111b26',
    borderLeftColor: '#3dd6a4',
    borderLeftWidth: 2,
    color: '#a9b7c7',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  code_inline: {
    backgroundColor: '#182230',
    color: '#90e8c8',
    fontFamily: 'monospace',
    fontSize: 13
  },
  fence: {
    backgroundColor: '#080d14',
    borderColor: '#263142',
    borderRadius: 5,
    borderWidth: 1,
    color: '#c9d5e3',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
    marginVertical: 10,
    padding: 12
  }
})
