# Vellum glossary

Vellum hands a screenshot to a vision model and asks it to draw the screen back; code measures how close the drawing came.

- **Screenshot**: the picture being traced: a Sample or the visitor's own upload. It never leaves the browser except as the images of a Pass, and is not stored.
- **Sample**: one of the four fictional Meridia screens in `public/vellum/samples/` (`domain/samples.ts`).
- **Squared up**: the Screenshot with the Sheet's grid ruled over it (a line every 50 units, labelled every 100), the way an artist squares up a picture to copy it. The model gets it beside the clean Screenshot.
- **Sheet**: the coordinate space of a Drawing: 1000 units wide, as tall as the Screenshot's aspect needs.
- **Draftsman**: the model (GPT-6.2 Astra by default) in its role here. It draws; it never scores.
- **Drawing**: the Draftsman's answer in the grammar `vellum.drawing/1` (`domain/drawing.ts`): a Palette, a Type scale, a background and Marks. Data, never markup. Always sanitized before it is drawn.
- **Mark**: one box, ellipse, line or line of text in a Drawing, with a stable id. Painted in order, back to front.
- **Palette** / **Type scale**: the colours and the text styles the Draftsman read off the Screenshot, written before any Mark.
- **Pass**: one call to the model: the Screenshot in, a whole Drawing out. A later Pass also gets its own last Drawing (as JSON and as rendered) and the Notes. Passes are what the rate limit counts.
- **Trace**: the Passes for one Screenshot, until a Rule says stop.
- **Ruler**: the code that measures a Drawing against the Screenshot (`domain/ruler.ts`), in the browser: it renders the Drawing, then scores Colour and Edges per Cell.
- **Cell**: one square of the Ruler's grid (20 across). The heat map shows them.
- **Likeness**: the Ruler's score, `(Colour + Edges) / 2`, for a Cell or the whole Sheet. **Colour** is one minus the mean colour distance; **Edges** is SSIM on brightness.
- **Notes**: the worst Cells of the last Pass, as Sheet coordinates and two hex colours, sent with the next Pass. Numbers only: the server writes the words.
- **Rules**: when a Trace stops: a target Likeness, or a number of Passes (`domain/rules.ts`).
