/**
 * The date-range slider's stops: days from today (1 = today only), then 'all'. One setting
 * per account (user_settings.due_window), shared by the board filter, Ah! Today's
 * "Coming up" and the phone, so moving it in one place moves it everywhere.
 */
export type DueWindow = 1 | 2 | 3 | 5 | 8 | 'all'
export const DUE_WINDOWS: DueWindow[] = [1, 2, 3, 5, 8, 'all']
export const dueWindowLabel = (w: DueWindow) => w === 'all' ? 'All' : w === 1 ? 'Today' : `${w} days`
