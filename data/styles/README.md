# Photo-print style references

`styles.json` maps each preset to its complete reference PNG and standalone prompt.
The supplied PNGs are preserved without cropping. Editorial and Field Note are
9:16; Watercolour uses the supplied 5:8 composition. All three are whole-image
styles (`composite: false`), so the uploaded result is stored as supplied.

Users view the references in the style picker and copy a standalone prompt,
then attach their travel photograph in their chosen AI app. They provide place,
country and year. Reference images are previews, with no download control.

Keep reference paths, prompts and the service-worker cache list in sync when
updating a preset. Increment the cache version after changing shipped files.
