# 28: NeoApp plays the tool animation under the face

**What to build:** When a `tool` event arrives with an animation, NeoApp keeps the thinking face and plays the animation in the card area under it (looping at its fps) with the short label beneath; when the tool event has none, today's text label shows. The animation stops when the answer card, an error or cancel arrives. Uses the existing pixel-card renderer where possible.

**Blocked by:** 27 Neo draws and remembers an animation for each tool it uses; 25 NeoApp settings screen — brain, model, listening, face, name

**Status:** blocked: code + unit tests done; on-device visual of the animation not captured (see notes)

- [x] Unit tests for the brain/state logic (animation shown on tool, cleared on card/error/cancel, fallback label)
- [ ] Debug APK builds; on the A7, asking something that uses a web search shows the stored animation the second time

Notes: Brain.toolArt/toolFrame (Brain.kt), PixelArt.from(NeoToolAnimation) (Card.kt), FaceView.drawToolArt; a tool event with an animation (or a later `animation` event for the current tool) plays it under the face, label stays in the sub; cleared on card/error/cancel/offline/new ask. Tests: ToolAnimationTest.kt. Device check not achieved: the answers came back in ~1s so screencaps never caught the thinking phase, and another agent kept taking the foreground.
