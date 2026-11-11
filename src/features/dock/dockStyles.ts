/**
 * Scroll area that fills the remaining height. Radix wraps viewport content in a
 * `display: table` div, which breaks text truncation, so it is forced back to block.
 */
export const dockScrollAreaClass = 'min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!'
