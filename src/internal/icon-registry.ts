import { registerIconFromText } from 'igniteui-webcomponents';

const internalIcons: Record<string, string> = {
  'arrow-upward':
    '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="arrow-downward" role="img" viewBox="0 0 45 45"><path d="M22.5 40V13.7L10.1 26.1 8 24 24 8l16 16-2.1 2.1-12.4-12.4V40Z"/></svg>',
  'arrow-downward':
    '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="arrow-downward" role="img" viewBox="0 0 45 45"><path fill="currentColor" d="M24 40 8 24l2.1-2.1 12.4 12.4V8h3v26.3l12.4-12.4L40 24Z"/></svg>',
  all: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="agall-desc agall-title"><title id="agall-title">Select All Icon</title><desc id="agall-desc">A picture showing tree lines and a check mark.</desc><path d="M2 14h8v2H2zm0-8h12v2H2zm14 11l-3-3-1.5 1.5L16 20l7-7-1.5-1.5L16 17zM2 10h12v2H2z"/></svg>',
  contains:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="czcontains-desc czcontains-title"><title id="czcontains-title">Contains Icon</title><desc id="czcontains-desc">A picture showing the lowercase letter A in a square box.</desc><path d="M3 3v18h18V3zm16 16H5V5h14z"/><path d="M12 11.3a4.39 4.39 0 00-2.54.63 2.07 2.07 0 00-.9 1.78 2.29 2.29 0 00.66 1.74 2.63 2.63 0 001.89.63 2.39 2.39 0 001.32-.37 3.05 3.05 0 001-.93 3.72 3.72 0 00.08.57c0 .19.1.38.16.58h1.79a4.51 4.51 0 01-.21-.88 5.57 5.57 0 01-.07-.93v-3.5a2.44 2.44 0 00-.84-2 3.34 3.34 0 00-2.22-.7 3.54 3.54 0 00-2.3.72A1.93 1.93 0 009 10.29h1.71a.93.93 0 01.29-.71 1.5 1.5 0 011-.29 1.45 1.45 0 011 .35 1.3 1.3 0 01.37 1v.69zm1.4 1.08v1.17a1.61 1.61 0 01-.71.77 2.27 2.27 0 01-1.21.34 1.18 1.18 0 01-.84-.27.92.92 0 01-.3-.72 1.16 1.16 0 01.44-.9 1.76 1.76 0 011.22-.39z"/></svg>',
  doesNotContain:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="eadoes-not-contain-desc eadoes-not-contain-title"><title id="eadoes-not-contain-title">Does-Not-Contain Icon</title><desc id="eadoes-not-contain-desc">A picture showing the lowercase letter A in a crossed-out square box.</desc><path d="M21 19.74V3H4.26L2.89 1.63 1.63 2.92 3 4.29V21h16.73l1.37 1.37 1.27-1.26zM5 19V6.28l5.28 5.27a3.19 3.19 0 00-.81.38 2.07 2.07 0 00-.9 1.78 2.29 2.29 0 00.66 1.74 2.63 2.63 0 001.89.63 2.39 2.39 0 001.32-.37 3.05 3.05 0 001-.93 3.72 3.72 0 00.08.57c0 .19.1.38.16.58h1L17.73 19zm5.79-6.23a1.31 1.31 0 01.45-.25l1.37 1.36.28.29a1.57 1.57 0 01-.19.15 2.27 2.27 0 01-1.21.34 1.18 1.18 0 01-.84-.27.92.92 0 01-.3-.72 1.16 1.16 0 01.44-.9zm2.6-1.47h-.83l-1.62-1.62.08-.1a1.5 1.5 0 011-.29 1.45 1.45 0 011 .35 1.3 1.3 0 01.37 1zM19 17.74l-3.85-3.85v-3.27a2.44 2.44 0 00-.84-2 3.34 3.34 0 00-2.22-.7 3.64 3.64 0 00-2.24.67L6.26 5H19z"/></svg>',
  greaterThan:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="fygreater-than-desc fygreater-than-title"><title id="fygreater-than-title">Greater Than Icon</title><desc id="fygreater-than-desc">A picture showing the greater-than symbol.</desc><path d="M6 7.11L15.09 12 6 16.89V19l12-6.46v-1.08L6 5v2.11z"/></svg>',
  greaterThanOrEqual:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="fzgreater-than-or-equal-desc fzgreater-than-or-equal-title"><title id="fzgreater-than-or-equal-title">Greater Than or Equal Icon</title><desc id="fzgreater-than-or-equal-desc">A picture showing the grater-than or equal symbol.</desc><path d="M5.99 19h12.02v2H5.99zM18 9.47L6 3v2.11L15.09 10 6 14.9v2.11l12-6.47V9.47z"/></svg>',
  empty:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="gsis-empty-desc gsis-empty-title"><title id="gsis-empty-title">Is Empty Icon</title><desc id="gsis-empty-desc">A picture showing a dotted square.</desc><path d="M5 17h2v2H5zm8 0h2v2h-2zm-8-4h2v2H5zm12 4h2v2h-2zM13 5h2v2h-2zM9 17h2v2H9zm8-8h2v2h-2zm0 4h2v2h-2zm0-8h2v2h-2zM5 9h2v2H5zm0-4h2v2H5zm4 0h2v2H9z"/></svg>',
  endsWith:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="enends-with-desc enends-with-title"><title id="enends-with-title">Ends With Icon</title><desc id="enends-with-desc">A picture showing three dots followed by lowercase a.</desc><path d="M3 14.5h2v2H3zm8 0h2v2h-2zm-4 0h2v2H7zm13.8.3v-3A2.1 2.1 0 0020 10a3 3 0 00-2-.6 3 3 0 00-2 .6 1.7 1.7 0 00-.7 1.5h1.5a.8.8 0 01.3-.7 1.3 1.3 0 01.9-.3 1.3 1.3 0 01.9.4 1.1 1.1 0 01.3.8v.6H18a3.8 3.8 0 00-2.2.6 1.8 1.8 0 00-.8 1.5 2 2 0 00.6 1.6 2.3 2.3 0 001.6.6 2.1 2.1 0 001.2-.4 2.8 2.8 0 00.8-.8 4.3 4.3 0 00.1.5l.1.5H21a4.1 4.1 0 01-.2-.7 5.4 5.4 0 010-1zm-1.6-.5a1.5 1.5 0 01-.6.7 2 2 0 01-1 .2 1.1 1.1 0 01-.8-.2.8.8 0 01-.2-.6 1 1 0 01.3-.8 1.5 1.5 0 011.1-.3h1.2z"/></svg>',
  equals:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="eoequals-desc eoequals-title"><title id="eoequals-title">Equals Icon</title><desc id="eoequals-desc">A picture showing the equals sign.</desc><path d="M5 13.5h14v2H5zm0-5h14v2H5z"/></svg>',
  false:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="gtis-false-desc gtis-false-title"><title id="gtis-false-title">Is False Icon</title><desc id="gtis-false-desc">A picture showing an encircled X symbol.</desc><path d="M8 5a7 7 0 107 7 7 7 0 00-7-7zm4.31 9.79l-1.52 1.52L8 13.52l-2.79 2.79-1.52-1.52L6.48 12 3.69 9.21l1.52-1.52L8 10.48l2.79-2.79 1.52 1.52L9.52 12zM18 7a5 5 0 00-3 1.06 7.48 7.48 0 01.49 1 3.89 3.89 0 110 5.82 8.08 8.08 0 01-.49 1A5 5 0 1018 7z"/><path d="M17.52 13.85l2.91-2.92-.78-.78-2.13 2.12-1.17-1.15-.38.37-.41.41.42.42L17 13.34l.52.51z"/></svg>',
  lessThan:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="hhless-than-desc hhless-than-title"><title id="hhless-than-title">Less Than Icon</title><desc id="hhless-than-desc">A picture showing the less-than symbol.</desc><path d="M6 12.54L18 19v-2.11L8.91 12 18 7.11V5L6 11.46v1.08z"/></svg>',
  lessThanOrEqual:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="hiless-than-or-equal-desc hiless-than-or-equal-title"><title id="hiless-than-or-equal-title">Less Than or Equal Icon</title><desc id="hiless-than-or-equal-desc">A picture showing the lass-than or equal symbol.</desc><path d="M5.99 19h12.02v2H5.99zM18 14.9L8.91 10 18 5.11V3L6 9.47v1.07l12 6.47V14.9z"/></svg>',
  notEmpty:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="ionot-empty-desc ionot-empty-title"><title id="ionot-empty-title">Not Empty Icon</title><desc id="ionot-empty-desc">A picture showing a crossed-out dotted square.</desc><path d="M5 9h2v2H5zm4 8h2v2H9zm4 0h2v2h-2zm4-8h2v2h-2zm0-4h2v2h-2zM5 17h2v2H5zm8-12h2v2h-2zm-8 8h2v2H5zm14 2v-2h-2v.47L18.53 15H19zm-8-8V5H9v.46L10.54 7H11zM2.76 1.76L1.5 3.06 20.97 22.5l1.26-1.26-8.89-8.89L2.76 1.76z"/></svg>',
  doesNotEqual:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-labelledby="ipnot-equal-desc ipnot-equal-title"><title id="ipnot-equal-title">Not Equal Icon</title><desc id="ipnot-equal-desc">A picture showing a crossed-out equals symbol.</desc><path d="M17.37 4.71l-1.74-1-2.76 4.79H5v2h6.71l-1.73 3H5v2h3.82l-2.19 3.79 1.74 1 2.76-4.79H19v-2h-6.71l1.73-3H19v-2h-3.82l2.19-3.79z"/></svg>',
  startsWith:
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="512" height="512" aria-labelledby="lqstarts-with-desc lqstarts-with-title"><title id="lqstarts-with-title">Starts With Icon</title><desc id="lqstarts-with-desc">A picture showing the uppercase letter A followed by three dots.</desc><path d="M5.9 7.5l-3.9 9h1.7l.7-1.8h4.1l.7 1.8H11l-3.9-9H5.9zM5 13.2l1.5-4.1L8 13.2H5zm7 1.3h2v2h-2v-2zm8 0h2v2h-2v-2zm-4 0h2v2h-2v-2z"/></svg>',
  true: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" aria-labelledby="gwis-true-desc gwis-true-title"><title id="gwis-true-title">is True Icon</title><desc id="gwis-true-desc">A picture showing an encircled check mark symbol.</desc><path d="M19.44 14.22zm-2.88 0zm0 0L18 12.79l1.44 1.43.78-.78L18.79 12l1.43-1.44-.78-.78L18 11.21l-1.44-1.43-.78.78L17.21 12l-1.43 1.44.78.78z"/><path d="M18 7a5 5 0 00-3 1.06 7.48 7.48 0 01.49 1 3.89 3.89 0 110 5.82 8.08 8.08 0 01-.49 1A5 5 0 1018 7zM8 5a7 7 0 107 7 7 7 0 00-7-7zm-.93 10.18l-3.38-3.37 1.13-1.12 2.25 2.25 4.11-4.12 1.13 1.12z"/></svg>',
  filter:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><path d="M20 36v-3h8v3Zm-8-10.5v-3h24v3ZM6 15v-3h36v3Z"/></svg>',
  close:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="m12.45 37.65-2.1-2.1L21.9 24 10.35 12.45l2.1-2.1L24 21.9l11.55-11.55 2.1 2.1L26.1 24l11.55 11.55-2.1 2.1L24 26.1Z"/></svg>',
  refresh:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 40q-6.65 0-11.325-4.675Q8 30.65 8 24q0-6.65 4.675-11.325Q17.35 8 24 8q4.25 0 7.45 1.725T37 14.45V8h3v12.7H27.3v-3h8.4q-1.9-3-4.85-4.85Q27.9 11 24 11q-5.45 0-9.225 3.775Q11 18.55 11 24q0 5.45 3.775 9.225Q18.55 37 24 37q4.15 0 7.6-2.375 3.45-2.375 4.8-6.275h3.1q-1.45 5.25-5.75 8.45Q29.45 40 24 40Z"/></svg>',
  'page-first':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
  'page-previous':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
  'page-next':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>',
  'page-last':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z"/></svg>',
  search:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15.5 14h-.79l-.28-.27a6.471 6.471 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.471 6.471 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
};

export function registerGridIcons() {
  for (const [name, svg] of Object.entries(internalIcons)) {
    registerIconFromText(name, svg, 'internal');
  }
}
