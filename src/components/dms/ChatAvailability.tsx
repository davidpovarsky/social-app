import {ChatUnavailableScreen} from '#/components/dms/ChatUnavailable'
import {CHAT_ENABLED} from '#/env'

/**
 * Keep unavailable chat routes from mounting queries or conversation actors.
 * The navigation entry remains available so people get a clear explanation.
 */
export function ChatAvailability({children}: {children: React.ReactNode}) {
  return CHAT_ENABLED ? children : <ChatUnavailableScreen />
}
