# Gore systems base

The entry page is a compact test rig for the procedural character, impact response, anatomy, blood, dismemberment, and loose piece physics. The reusable modules live in `systems/`.

## Main modules

- `character.js`, `costumes.js`, `shapes.js`, and the model helpers build the procedural character meshes.
- `physics.js` and `ragdoll.js` provide the Rapier world setup and articulated rigid body.
- `blood.js`, `wounds.js`, `bloodsurf.js`, `stain.js`, `artery.js`, `organs.js`, and `inks.js` handle blood, wounds, organs, and surface effects.
- `slice.js` provides geometry slicing, cut surfaces, and physics driven severed pieces; `gibs.js` owns burst fragments; `intestines.js` adds a textured, breakable physics chain; `ropes.js` manages manually placed, cuttable tethers.
- `rig.js` connects the character pose to the ragdoll and demonstrates a minimal actor interface for the gore modules.

`app.js` creates the scene, initializes Rapier, attaches blood, dismemberment, intestines, and rope tools to the rig, advances physics, and updates the render loop. `Rig` exposes `goRagdoll()`, `impact()`, `sever(system, type)`, `update(dt)`, and `reset(system)`.

The starting project is [WebTheftAuto 67 by Rick_Deckard](https://websim.com/@Rick_Deckard/webtheftaut6). Its character, physics, blood, and procedural dismemberment modules remain separately addressable under `systems/`; level building, weapons, vehicles, multiplayer, chat, and unrelated game UI were removed.
