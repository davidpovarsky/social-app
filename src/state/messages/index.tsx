import {CurrentConvoIdProvider} from '#/state/messages/current-convo-id'
import {MessagesEventBusProvider} from '#/state/messages/events'
import {ListConvosProvider} from '#/state/queries/messages/list-conversations'
import {CHAT_ENABLED} from '#/env'
import {MessageDraftsProvider} from './message-drafts'

export function MessagesProvider({children}: {children: React.ReactNode}) {
  return (
    <CurrentConvoIdProvider>
      <MessageDraftsProvider>
        {CHAT_ENABLED ? (
          <MessagesEventBusProvider>
            <ListConvosProvider>{children}</ListConvosProvider>
          </MessagesEventBusProvider>
        ) : (
          children
        )}
      </MessageDraftsProvider>
    </CurrentConvoIdProvider>
  )
}
