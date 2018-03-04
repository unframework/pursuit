const fs = require('fs');
const onecolor = require('onecolor');
const vec2 = require('gl-matrix').vec2;
const vec3 = require('gl-matrix').vec3;
const vec4 = require('gl-matrix').vec4;
const mat4 = require('gl-matrix').mat4;
const glsl = require('glslify');

const Timer = require('./Timer');
const parseGLSLConstants = require('./parseGLSLConstants');
const { createSegmentRenderer } = require('./segment');
const { getSegmentItemBatchDefinition, createSegmentItemBatchRenderer } = require('./segmentItemBatch');

const ROAD_SETTINGS = parseGLSLConstants(
    fs.readFileSync(__dirname + '/roadSettings.glsl', 'utf8')
);

document.title = 'Pursuit Hunter';

document.body.parentElement.style.height = '100%';
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.height = '100%';
document.body.style.background = '#70787f';
document.body.style.position = 'relative';

const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.top = '0vh';
canvas.style.left = '0vw';
canvas.style.width = '100vw';
canvas.style.height = 'calc(100vh - 120px)';
canvas.style.background = '#fff';
document.body.appendChild(canvas);

if (window.location.host.indexOf('localhost') === -1) {
    const player = document.createElement('iframe');
    player.width = "100%";
    player.height = "120";
    player.scrolling = "no";
    player.frameborder = "no";
    player.style.border = "0";
    player.allow = "autoplay";
    player.src = 'https://w.soundcloud.com/player/?' + [
        'url=https%3A//api.soundcloud.com/playlists/457658343',
        'color=%23ff5555',
        'auto_play=true',
        'hide_related=false',
        'show_comments=true',
        'show_user=true',
        'show_reposts=false',
        'show_teaser=true'
    ].join('&');

    player.style.position = 'absolute';
    player.style.bottom = '0';
    player.style.left = '0vw';
    document.body.appendChild(player);
}

canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;
const aspectRatio = canvas.height / canvas.width;

const div = document.createElement('div');
div.style.position = 'fixed';
div.style.bottom = 'calc(120px + 10px)';
div.style.right = '20px';
div.style.opacity = 0.2;
div.style.color = '#fff';
div.style.fontFamily = 'Arial';
div.style.fontSize = '24px';
div.appendChild(document.createTextNode('@line_ctrl'));
document.body.appendChild(div);

const regl = require('regl')({
    canvas: canvas,
    attributes: { antialias: false, alpha: false }
});

roadCmd = regl({
    vert: glsl`
        precision mediump float;

        #pragma glslify: roadSettings = require('./roadSettings')

        uniform float cameraSideOffset;
        uniform mat4 camera;
        uniform float segmentOffset;
        uniform float segmentLength;
        attribute vec2 position;

        varying vec2 viewPlanePosition;

        void main() {
            float roadHalfWidth = (roadLaneWidth * 3.0 + roadShoulderWidth * 2.0) * 0.5;
            float roadY = position.y * segmentLength + segmentOffset;

            gl_Position = camera * vec4(
                0,
                roadY,
                0,
                1.0
            );

            vec4 edgePosition = camera * vec4(
                roadHalfWidth * position.x,
                roadY,
                0,
                1.0
            );

            // @todo horizontal camera movement is totally busted
            viewPlanePosition = vec2(
                gl_Position.w * roadHalfWidth / (edgePosition.x - gl_Position.x) + cameraSideOffset,
                roadY
            );

            // un-correct perspective to fill screen horizontally
            gl_Position.x = position.x * gl_Position.w;
        }
    `,

    frag: glsl`
        precision mediump float;

        #pragma glslify: roadSettings = require('./roadSettings')
        #pragma glslify: computeSegmentX = require('./segment')

        uniform float segmentOffset;
        uniform vec3 segmentCurve;
        uniform vec3 roadColor;
        uniform vec3 roadHighlightColor;
        uniform vec3 markerColor;
        uniform vec3 markerHighlightColor;

        varying vec2 viewPlanePosition;

        void main() {
            float roadHalfWidth = (roadLaneWidth * 3.0 + roadShoulderWidth * 2.0) * 0.5;

            float segmentDepth = viewPlanePosition.y - segmentOffset;
            vec2 segmentPosition = vec2(
                viewPlanePosition.x - computeSegmentX(segmentDepth, segmentCurve),
                viewPlanePosition.y
            );

            float lightDistance = abs((mod(segmentPosition.y - lightOffset, lightSpacing) / lightSpacing) - 0.5) / 0.5;

            if (abs(segmentPosition.x) > roadHalfWidth) {
                float fieldFactor = step(25.0, mod(segmentPosition.y, 50.0));
                gl_FragColor = vec4(0.08, 0.08 + 0.02 * fieldFactor, 0.18 + 0.08 * fieldFactor, 1.0);
                return;
            }

            float distToMidLane = abs(roadLaneWidth * 0.5 - abs(segmentPosition.x));
            float distToEdgeLane = abs(roadLaneWidth * 1.5 - abs(segmentPosition.x));

            float notMidLane = 1.0 - (
                step(distToMidLane, roadMarkerWidth * 0.5) *
                step(roadLaneMarkerLength, mod(segmentPosition.y, roadLaneMarkerLength * 2.0))
            );
            float notEdgeLane = step(roadMarkerWidth * 0.5, distToEdgeLane);
            float notMarker = notMidLane * notEdgeLane;

            float quantLightPos = floor(lightDistance * 4.0 + 0.5) / 4.0;

            vec3 color = notMarker < 1.0
                ? mix(markerColor, markerHighlightColor, quantLightPos)
                : mix(roadColor, roadHighlightColor, quantLightPos);

            gl_FragColor = vec4(color, 1.0);
        }
    `,

    attributes: {
        position: regl.buffer([
            [ -1, 0 ],
            [ 1, 0 ],
            [ 1,  1 ],
            [ -1, 1 ]
        ])
    },

    uniforms: {
        roadColor: regl.prop('roadColor'),
        roadHighlightColor: regl.prop('roadHighlightColor'),
        markerColor: regl.prop('markerColor'),
        markerHighlightColor: regl.prop('markerHighlightColor'),
        cameraSideOffset: regl.prop('cameraSideOffset'),
        camera: regl.prop('camera')
    },

    primitive: 'triangle fan',
    count: 4
});

postCmd = regl({ context: { batchItem: { vert: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')
    #pragma glslify: computeSegmentX = require('./segment')

    varying float xOffset;

    void batchItemSetup(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        xOffset = computeSegmentX(segmentDepth, segmentCurve);
    }

    vec3 batchItemCenter(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        return vec3(
            postOffset + xOffset,
            0,
            (postHeight - postRadius) * 0.5
        );
    }

    vec2 batchItemSize(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        return vec2(
            postWidth,
            postHeight - postRadius
        ) * 0.5;
    }
`, frag: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')

    vec4 batchItemColor(vec2 facePosition) {
        vec2 relpos = (facePosition * vec2(0.5, 0.5) + vec2(0.5, 0.5));
        vec2 pos = relpos * vec2(postWidth, postHeight);
        pos -= mod(pos, 0.15);

        vec2 fadePos = pos / vec2(postWidth, postHeight);

        return vec4(
            (0.2 * (0.15 + fadePos.y * 0.85)) * postLightColor,
            step(pos.x, postWidth)
        );
    }
` } } });

postTopCmd = regl({ context: { batchItem: { vert: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')
    #pragma glslify: computeSegmentX = require('./segment')

    varying float xOffset;

    void batchItemSetup(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        xOffset = computeSegmentX(segmentDepth, segmentCurve);
    }

    vec2 batchItemSize(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        return vec2(
            postRadius + postStem,
            postRadius
        ) * 0.5;
    }

    vec3 batchItemCenter(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        vec2 size = batchItemSize(segmentOffset, segmentCurve, segmentDepth);

        return vec3(
            postOffset + postWidth * 0.5 + xOffset,
            0,
            postHeight
        ) - vec3(
            size.x,
            0,
            size.y
        );
    }
`, frag: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')

    vec4 batchItemColor(vec2 facePosition) {
        vec2 relpos = (facePosition * vec2(0.5, 0.5) + vec2(0.5, 0.5));
        vec2 pos = relpos * vec2(postRadius + postStem, postRadius);
        pos -= mod(pos, 0.15);

        float fade = 1.0 - (pos.x - 0.15) / (postRadius + postStem);

        vec2 radial = vec2(max(0.0, pos.x - postStem), pos.y);
        float radiusSq = dot(radial, radial);
        float postLightInner = postRadius - postWidth - 0.05;

        return vec4(
            (0.2 - fade * 0.05) * postLightColor,
            step(radiusSq, postRadius * postRadius)
                * step(postLightInner * postLightInner, radiusSq)
        );
    }
` } } });

postLightCmd = regl({ context: { batchItem: { vert: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')
    #pragma glslify: computeSegmentX = require('./segment')

    varying float xOffset;

    void batchItemSetup(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        xOffset = computeSegmentX(segmentDepth, segmentCurve);
    }

    vec3 batchItemCenter(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        return vec3(
            postOffset + postWidth * 0.5 - postRadius - postStem - postLightWidth * 0.5 + xOffset,
            0,
            postHeight - postLightHeight * 0.5
        );
    }

    vec2 batchItemSize(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        return vec2(
            postLightWidth,
            postLightHeight
        ) * 0.5;
    }
`, frag: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')

    vec4 batchItemColor(vec2 facePosition) {
        return vec4(
            postLightColor,
            1.0
        );
    }
` } } });

function createSpriteTexture(sourcePromise, textureW, textureH, levels, surfaceDepth, surfaceXOffset) {
    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.style.position = 'absolute';
    spriteCanvas.style.top = '0px';
    spriteCanvas.style.left = '0px';
    spriteCanvas.style.background = '#222';
    // document.body.appendChild(spriteCanvas);

    spriteCanvas.width = textureW;
    spriteCanvas.height = textureH * levels.length;
    const spriteCtx = spriteCanvas.getContext('2d');

    const textureWValues = Array(...new Array(textureW)).map((_, index) => index);
    const textureHValues = Array(...new Array(textureH)).map((_, index) => index);

    // pre-create empty texture for later fill
    const spriteTexture = regl.texture({
        width: textureW,
        height: textureH,
        min: 'nearest',
        mag: 'nearest'
    });

    sourcePromise.then(function (sourceImage) {
        const sourceW = sourceImage.width;
        const sourceH = sourceImage.height;

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.style.position = 'absolute';
        sourceCanvas.style.top = '0px';
        sourceCanvas.style.left = '0px';
        sourceCanvas.style.background = '#222';
        document.body.appendChild(sourceCanvas);

        sourceCanvas.width = sourceW;
        sourceCanvas.height = sourceH;

        const sourceCtx = sourceCanvas.getContext('2d');
        sourceCtx.drawImage(sourceImage, 0, 0);

        // render the texture
        levels.forEach((perspectiveDepth, index) => {
            // @todo use middle of range?
            const visibleSideRun = surfaceXOffset * surfaceDepth / (perspectiveDepth + surfaceDepth);

            const cameraHeightRatio = CAMERA_HEIGHT / ROAD_SETTINGS.fenceHeight;
            const cameraHeightRatio2 = 1 - cameraHeightRatio;

            const texelBiasW = 1 / (2 * textureW);
            const texelBiasH = 1 / (2 * textureH);

            spriteCtx.clearRect(0, index * textureH, textureW, textureH);

            const testColor = [ '#ff0', '#f0f', '#f00', '#0f0', '#00f', '#0ff' ][index];

            textureWValues.forEach(px => {
                textureHValues.forEach(py => {
                    const faceX = px / textureW + texelBiasW;
                    const faceY = py / textureH + texelBiasH;

                    const sideRunPortion = (1 - faceX) * visibleSideRun;
                    const surfaceZ = sideRunPortion * perspectiveDepth / (surfaceXOffset - sideRunPortion);
                    const surfaceX = surfaceZ / surfaceDepth;
                    const surfaceY = (faceY - cameraHeightRatio) * (perspectiveDepth + surfaceZ) / perspectiveDepth + cameraHeightRatio;

                    if (surfaceY >= 1) {
                        return;
                    }

                    if (surfaceY < 0) {
                        return;
                    }

                    const sourceX = Math.floor(surfaceX * sourceW);
                    const sourceY = sourceH - 1 - Math.floor(surfaceY * sourceH);
                    const sourcePixel = sourceCtx.getImageData(sourceX, sourceY, 1, 1).data;

                    spriteCtx.fillStyle = `rgb(${sourcePixel[0]}, ${sourcePixel[1]}, ${sourcePixel[2]})`;
                    spriteCtx.fillRect(px, index * textureH + py, 1, 1);
                });
            });
        });

        // upload to texture
        spriteTexture({
            width: textureW,
            height: textureH,
            min: 'nearest',
            mag: 'nearest',
            data: spriteCtx
        });
    });

    return spriteTexture;
}

function createFenceCommand(spriteTexture, levelCount, closeupDistance, cameraHeight) {
    return regl({ context: { batchItem: { vert: glsl`
        #pragma glslify: roadSettings = require('./roadSettings')
        #pragma glslify: computeSegmentX = require('./segment', computeSegmentDX=computeSegmentDX)

        #define closeupDistance float(${closeupDistance})
        #define cameraHeight float(${cameraHeight})

        uniform float cameraOffset;
        uniform float cameraSideOffset;
        uniform float hFlip;

        varying float xOffset;
        varying float depth;
        varying float closeupScale;

        void batchItemSetup(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
            xOffset = computeSegmentX(segmentDepth, segmentCurve);
            depth = segmentOffset + segmentDepth - cameraOffset;
            closeupScale = clamp(depth / closeupDistance, 0.0, 1.0);
        }

        vec3 batchItemCenter(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
            return vec3(
                hFlip * fenceXOffset + xOffset,
                0,
                cameraHeight + (fenceHeight * 0.5 - cameraHeight) * closeupScale
            );
        }

        vec2 batchItemSize(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
            float xOffsetDelta = computeSegmentDX(fenceSpacing, segmentDepth, segmentCurve);

            float visibleSideWidth = hFlip * (hFlip * fenceXOffset + xOffset - cameraSideOffset) * fenceSpacing / (depth + fenceSpacing);
            float visibleCurvatureAdjustment = hFlip * xOffsetDelta * depth / (depth + fenceSpacing);

            return vec2(
                clamp(visibleSideWidth - visibleCurvatureAdjustment, 0.2, 10000.0),
                fenceHeight * 0.5 * closeupScale
            );
        }
    `, frag: glsl`
        #pragma glslify: roadSettings = require('./roadSettings')

        #define levelCount ${levelCount}

        uniform float hFlip;
        uniform float level;
        uniform sampler2D sprite;

        vec4 batchItemColor(vec2 facePosition) {
            vec2 spritePos = facePosition * vec2(hFlip, 0.5) + vec2(1.0, 0.5);

            return texture2D(
                sprite,
                (spritePos + vec2(0.0, level)) / vec2(1.0, float(levelCount))
            ) * vec4(
                1.0,
                1.0,
                1.0,
                step(hFlip * facePosition.x, 0.1) // draw one side with an extra "lip" for overlap
            );
        }
    ` } }, uniforms: {
        hFlip: regl.prop('hFlip'),
        level: regl.prop('level'),
        sprite: spriteTexture,
        cameraOffset: regl.prop('cameraOffset'),
        cameraSideOffset: regl.prop('cameraSideOffset')
    } });
}

bgCmd = regl({
    vert: glsl`
        precision mediump float;

        attribute vec2 position;
        varying vec2 facePosition;

        void main() {
            facePosition = position;
            gl_Position = vec4(position, 0.99999, 1.0);
        }
    `,

    frag: glsl`
        precision mediump float;

        #define bandSize 0.1

        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec2 facePosition;

        void main() {
            float fade = clamp(1.0 - facePosition.y, 0.0, 1.0);
            float fadeSq = fade * fade;
            float qFade = fadeSq - mod(fadeSq -0.01, bandSize);

            gl_FragColor = vec4(mix(topColor, bottomColor, qFade), 1.0);
        }
    `,

    attributes: {
        position: regl.buffer([
            [ -1, 0 ],
            [ 1, 0 ],
            [ 1,  1 ],
            [ -1, 1 ]
        ])
    },

    uniforms: {
        topColor: regl.prop('topColor'),
        bottomColor: regl.prop('bottomColor')
    },

    depth: { func: 'always' },

    primitive: 'triangle fan',
    count: 4
});

function loadImage(imageURI) {
    const textureImage = new Image();

    const texturePromise = new Promise(function (resolve) {
        textureImage.onload = function () {
            resolve(textureImage);
        };
    });

    textureImage.crossOrigin = 'anonymous'; // prevent "tainted canvas" warning when blitting this
    textureImage.src = imageURI;

    return texturePromise;
}

const cameraPosition = vec3.create();
const camera = mat4.create();

const STEP = 1 / 60.0;

const CAMERA_HEIGHT = 1.0;
const DRAW_DISTANCE = 800;

let offset = 0; // @todo wrap periodically to avoid precision issues
const speed = 200 / 3.6; // km/h to m/s

const aspect = canvas.width / canvas.height;
const fovX = 0.8;
const fovY = 2.0 * Math.atan(Math.tan(fovX * 0.5) / aspect);

const bgTopColor = vec3.fromValues(...onecolor('#005555').toJSON().slice(1));
const bgBottomColor = vec3.fromValues(...onecolor('#ff5555').toJSON().slice(1));
const roadColor = vec3.fromValues(...onecolor('#000055').toJSON().slice(1));
const roadHighlightColor = vec3.fromValues(...onecolor('#aa5500').toJSON().slice(1));
const markerColor = vec3.fromValues(...onecolor('#005555').toJSON().slice(1));
const markerHighlightColor = vec3.fromValues(...onecolor('#ffffff').toJSON().slice(1));

const segmentList = [];

// no need for sprite distance closer than 20 because the added transition "pop" is too close and not worth the precision
const fenceTextureW = 32;
const fenceTextureH = 32;
const fenceLevels = [ 20, 40, 80, 160, 1000 ];

const fenceImageURI = 'data:application/octet-stream;base64,' + btoa(require('fs').readFileSync(__dirname + '/wall.png', 'binary'))
const fenceImagePromise = loadImage(fenceImageURI);

const fenceTexture = createSpriteTexture(
    fenceImagePromise,
    fenceTextureW,
    fenceTextureH,
    fenceLevels,
    ROAD_SETTINGS.fenceSpacing,
    ROAD_SETTINGS.fenceXOffset
);
const fenceCmd = createFenceCommand(fenceTexture, fenceLevels.length, (ROAD_SETTINGS.fenceSpacing - 3), CAMERA_HEIGHT);

const segmentRenderer = createSegmentRenderer(regl);
const lightSegmentItemBatchRenderer = createSegmentItemBatchRenderer(
    regl,
    segmentRenderer,
    5,
    ROAD_SETTINGS.lightSpacing,
    ROAD_SETTINGS.lightOffset
);

// offset to be right after the light post to avoid overlapping it
const fenceSegmentItemBatchRenderer = createSegmentItemBatchRenderer(
    regl,
    segmentRenderer,
    50,
    ROAD_SETTINGS.fenceSpacing,
    6
);

const timer = new Timer(STEP, 0, function () {
    offset += speed * STEP;

    const totalEnd = segmentList.length > 0
        ? segmentList[segmentList.length - 1].end
        : 0;

    if (totalEnd < offset + DRAW_DISTANCE) {
        const length = 150 + Math.floor(Math.random() * 8) * 50;

        segmentList.push({
            length: length,
            curvature: 8 * (Math.random() * 2 - 1),
            end: totalEnd + length
        });
    }

    if (segmentList.length > 0 && segmentList[0].end < offset + 3.1) {
        segmentList.shift();
    }
}, function (now) {
    mat4.perspective(camera, fovY, aspect, 1, DRAW_DISTANCE);

    // pitch
    mat4.rotateX(camera, camera, -Math.PI / 2);

    // camera shake and offset
    const sideOffset = 2.0 * Math.cos(now * 0.75) + 0.02 * Math.cos(now * 3.17);

    vec3.set(cameraPosition, -sideOffset, -offset, -CAMERA_HEIGHT + 0.02 * Math.cos(now * 2.31));
    mat4.translate(camera, camera, cameraPosition);

    bgCmd({
        topColor: bgTopColor,
        bottomColor: bgBottomColor,
    });

    segmentRenderer(segmentList, offset, function () {
        roadCmd({
            roadColor: roadColor,
            roadHighlightColor: roadHighlightColor,
            markerColor: markerColor,
            markerHighlightColor: markerHighlightColor,
            cameraSideOffset: sideOffset,
            camera: camera
        });
    });

    lightSegmentItemBatchRenderer(segmentList, 0, DRAW_DISTANCE, offset, camera, function (renderCommand) {
        postCmd(renderCommand);
    });
    lightSegmentItemBatchRenderer(segmentList, 0, DRAW_DISTANCE, offset, camera, function (renderCommand) {
        postTopCmd(renderCommand);
    });
    lightSegmentItemBatchRenderer(segmentList, 0, DRAW_DISTANCE, offset, camera, function (renderCommand) {
        postLightCmd(renderCommand);
    });

    fenceLevels.forEach((levelDistance, level) => {
        // ensure absolute minimum distance for sprites to avoid extreme close-up flicker
        const prevDistance = level === 0 ? 0 : fenceLevels[level - 1];

        fenceSegmentItemBatchRenderer(segmentList, prevDistance, levelDistance, offset, camera, function (renderCommand) {
            fenceCmd({
                hFlip: -1,
                level: level,
                cameraOffset: offset,
                cameraSideOffset: sideOffset
            }, renderCommand);
        });

        fenceSegmentItemBatchRenderer(segmentList, prevDistance, levelDistance, offset, camera, function (renderCommand) {
            fenceCmd({
                hFlip: 1,
                level: level,
                cameraOffset: offset,
                cameraSideOffset: sideOffset
            }, renderCommand);
        });
    });
});
