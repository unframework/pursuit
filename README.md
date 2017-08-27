# Pursuit Hunter Night Drive

## Architecture

It makes sense to break things up into biomes of sorts. Even though some things are reusable between them (road signs, etc), they define a lot of the shape. And transitions are important to get right.

Road topology is independent of a biome. Tunnels could be less conducive to on/offramps, but I don't see why avoid them. Especially since urban tunnels feature them often. However, biome boundaries have to be simple and well-defined - no offramp right before a biome change.

Physics is then only dependent on road topology. Biome definition code receives the latter, too, with a guarantee of "clean" entry/exit.

Topology seems to make sense as series of circular arcs. Not entirely realistic, but definitely mimics games.

Things like lights, etc, are part of a biome definition. So then they should be independent of a road segment.

Another complication is lane count.

## To Do

- use solipsistic origin point
- spline render for roadway and fences
- road texture
- lighting model, average lights plus passing spotlight (use light-field approach with 2D texture?)
- overhead signs and speed indication signs
- road-painted signs
- traffic
- onramp/offramp
- track remote objects set
- semi-irregular horizon twinkly lights (do major road outlines and random inbetween)
- overpasses and underpasses
