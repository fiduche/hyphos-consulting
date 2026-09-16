// On-course contests for the Springs Men's Golf Classic.
//
// ONE place to edit before the event. The worker validates against this list
// and the board and entry pages render from it, so adding a contest or moving
// it to another hole is a change here and nothing else.
//
// mode:
//   'latest' marker style, last entry leads. How the paper sheets already work:
//            nobody measures, the marker moves to the better ball and that
//            player posts. Used for closest to the pin, drive and putt.
//   'low' / 'high'  measured, smallest or largest wins. Kept for contests with
//            a tape measure on hand; not used this year.
//   'list'   qualifying list, no ranking    (landed in the square: drawn later)
//
// code: the short path printed in the QR, /C/<CODE>. Keep it 2 to 6 letters.
// hole: shown on the board and the sign. null hides it.
// maxFeet: sanity cap on a measured entry, so a typo can't take the lead.

export const CONTESTS = [
  {
    id: 'ctp', code: 'CTP', hole: 3, mode: 'latest',
    title: 'Closest to the pin',
    rule: 'Closer than the marker? Move the marker to your ball, then post. The latest entry leads.',
  },
  {
    id: 'drive', code: 'LD', hole: null, mode: 'latest',
    title: 'Longest drive',
    rule: 'Past the marker? Move the marker to your ball, then post. The latest entry leads.',
  },
  {
    id: 'putt', code: 'LP', hole: null, mode: 'latest',
    title: 'Longest putt',
    rule: 'Made a putt from further out than the marker? Move the marker, then post. The latest entry leads.',
  },
  {
    id: 'square', code: 'SQ', hole: null, mode: 'list',
    title: 'Hit the square',
    sponsor: 'Hyphos Consulting',
    rule: 'Land in the marked square and you are in the draw for a $500 gift card.',
  },
];

export const CONTEST_BY_ID = Object.fromEntries(CONTESTS.map((c) => [c.id, c]));
export const CONTEST_BY_CODE = Object.fromEntries(CONTESTS.map((c) => [c.code.toLowerCase(), c]));
export const isMeasured = (c) => c.mode === 'low' || c.mode === 'high';

/** 150 inches -> 12' 6" */
export const formatInches = (total) => {
  if (total == null) return '';
  const ft = Math.floor(total / 12);
  const inch = Math.round(total - ft * 12);
  return inch ? `${ft}′ ${inch}″` : `${ft}′`;
};
