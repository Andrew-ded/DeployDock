// В боевой сборке моки подменяются этой заглушкой, чтобы демо-данные не попали в бандл.
import type { Api } from '../api'
export const mockApi = {} as Api
