# CHICKEN CANNON: Office Chair Armageddon

A gloriously stupid physics game. Launch rubber chickens at a stack of traitorous office chairs.

## Play

Open `index.html` in any modern browser. No build step, no server needed (though a local server helps with sound).

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Controls

- **Drag & release** - slingshot style. Press anywhere, pull back, let go. The chicken flies the opposite way.
- **M** - mute / unmute
- **Space** - start from the title screen

## Goal

Destroy every office chair before your chickens run out.

- **100 pts** per chair, with a combo multiplier for destroying several in one shot
- **+50** for knocking a chair off the building
- **Overtime bonus**: every 3 chairs destroyed earns you a spare chicken
- **Bonk the intern** at your own risk (-25 pts, he remembers)

## The Secret Sauce

Every so often the office's "efficiency review" kicks in and something absurd falls from the sky:

- **A giant coffee mug** stamped with a corporate buzzword (SYNERGY, AGILE, KPIs, etc.) that absolutely murders whatever is under it. +200 for the impact.
- **A rain of rubber ducks** that squish on landing.
- **A fire drill** that shoves every chair out of the building.

The office is cursed. Do not ask why.

## Tech

- [Matter.js](https://brm.io/matter-js/) for physics (vendored in `vendor/`, no network needed)
- Canvas 2D rendering, all art drawn procedurally (no image assets)
- Web Audio API for sound, all effects synthesized (no audio files)
- Single `game.js`, no dependencies to install

## Files

- `index.html` - page shell + start/end screens
- `game.js` - the whole game
- `vendor/matter.min.js` - Matter.js 0.19.0
