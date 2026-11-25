// ─────────────────────────────────────────────────────────────────────────────
// The KYN logo as terminal text: 68 columns x 36 rows of plain ASCII.
//
// ART is what gets printed. TONE says how bright each character is:
//   b = bright   n = normal   d = dim   (space = nothing)
// Both arrays line up character for character. The app and the terminal
// version (npm run boot:cli) both draw from this file, so they match exactly.
// Traced from the KYN reference artwork onto a monospace grid.
// ─────────────────────────────────────────────────────────────────────────────

export const ART = [
  '                                               |',
  '                                               +###=',
  '                                               |  -=.',
  '                                               +    .',
  '                                      -      ::#####+',
  '                                      ----:::=:=######',
  '                                        ::==:=. +######+',
  '                                       =:==:      -#####+',
  '         -----    ------- - -        -=::=        +######+',
  '                          -  -=:====:=:           --#######',
  '                               ======+                   .##',
  '                      .       .===+-                       ##+',
  '                            ::=                        .+   ###-',
  '      --===============----:===+ . +#######=      =#####+    :###',
  '        --------------=====:==  .:: =########+  +#####        +###+',
  '                  ---.--==:                +## +##            --###+',
  '-----                  -::=====:                           +####+',
  '               -   =============-+::                    :###=',
  '                          -----=+====:::               ##-',
  '                                 -=====:::            ##',
  '                                   -:===:::          ##+',
  '                                     .===::::       ++',
  '                                  --.-=====:::     +++',
  '                           -- ---      --++==#     ++',
  '                               ---         ==#:   ++',
  '                                            +##+  +:',
  '                                             +#+',
  '                                  ---   :.   +++',
  '                                         -:  +++',
  '                                          |  +++',
  '                                          |  +++',
  '                                          |  +++',
  '                                              ++',
  '                                              ++',
  '                                              +',
  '                                              +',
];

export const TONE = [
  '                                               n',
  '                                               bbbbn',
  '                                               n  nnd',
  '                                               b    d',
  '                                      d      ddbbbbbb',
  '                                      dddddddndbbbbbbb',
  '                                        ddnnddd bbbbbbbb',
  '                                       ddddd      dbbbbbb',
  '         dnnnd    ddddddd d d        ddddd        bbbbbbbb',
  '                          d  dddddddddd           nbbbbbbbb',
  '                               dnnnndn                   dbb',
  '                      d       dddnnn                       bbb',
  '                            ddb                        db   bbbn',
  '      dbbnbbnnbbbbbbbnbbbnddnnnn d nbbbbbbbn      nbbbbbb    dbbb',
  '        bnbbbnnnndbnbbnnbbndnd  ddd nbbbbbbbbb  bbbbbb        bbbbb',
  '                  ddddddddd                bbb bbb            dbbbbb',
  'nndnn                  dddnnnnnd                           bbbbbb',
  '               n   nbnnbbbbnbnnnnndd                    dbbbb',
  '                          ddnnnnnnnnnddd               bbb',
  '                                 nnnddnddd            bb',
  '                                   ddndnddd          bbb',
  '                                     dndndddd       bb',
  '                                  ddddnnnnnddd     bbb',
  '                           nd ndd      ddbbnnb     bb',
  '                               ddd         nbbd   bb',
  '                                            bbbb  bd',
  '                                             bbb',
  '                                  ddd   dd   bbb',
  '                                         dd  bbb',
  '                                          n  bbb',
  '                                          n  bbb',
  '                                          n  bbb',
  '                                              bb',
  '                                              bb',
  '                                              b',
  '                                              b',
];

export const LOGO_WIDTH = Math.max(...ART.map((row) => row.length));
export const LOGO_HEIGHT = ART.length;
