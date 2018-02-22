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

document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.background = '#70787f';
document.body.style.position = 'relative';

const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.top = '0vh';
canvas.style.left = '0vw';
canvas.style.width = '100vw';
canvas.style.height = '100vh';
canvas.style.background = '#fff';
document.body.appendChild(canvas);

canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;
const aspectRatio = canvas.height / canvas.width;

const div = document.createElement('div');
div.style.position = 'fixed';
div.style.bottom = '10px';
div.style.right = '20px';
div.style.opacity = 0.2;
div.style.color = '#fff';
div.style.fontFamily = 'Arial';
div.style.fontSize = '24px';
div.appendChild(document.createTextNode('@line_ctrl'));
document.body.appendChild(div);

const regl = require('regl')({
    canvas: canvas,
    attributes: { antialias: false }
});

roadCmd = regl({
    vert: glsl`
        precision mediump float;

        #pragma glslify: roadSettings = require('./roadSettings')

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
                gl_Position.w * roadHalfWidth / (edgePosition.x - gl_Position.x),
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

        varying vec2 viewPlanePosition;

        void main() {
            float roadHalfWidth = (roadLaneWidth * 3.0 + roadShoulderWidth * 2.0) * 0.5;

            float segmentDepth = viewPlanePosition.y - segmentOffset;
            vec2 segmentPosition = vec2(
                viewPlanePosition.x - computeSegmentX(segmentDepth, segmentCurve),
                viewPlanePosition.y
            );

            float lightPos = 1.5 - 0.5 / (0.5 + abs((mod(segmentPosition.y - lightOffset, lightSpacing) / lightSpacing) - 0.5));

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

            float lightness = (notMarker < 1.0
                ? (0.3 + lightPos * 0.7)
                : (0.2 + lightPos * 0.8)
            );

            float steppedLightness = 0.1 + (floor(lightness * 20.0) * 0.05) * 1.2;

            vec3 color = notMarker < 1.0
                ? vec3(0.75, 0.87, 0.87)
                : vec3(0.10, 0.35, 0.35);

            gl_FragColor = vec4(color * steppedLightness, 1.0);
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

fenceCmd = regl({ context: { batchItem: { vert: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')
    #pragma glslify: computeSegmentX = require('./segment', computeSegmentDX=computeSegmentDX)

    uniform float cameraOffset;

    varying float xOffset;
    varying float depth;

    void batchItemSetup(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        xOffset = computeSegmentX(segmentDepth, segmentCurve);
        depth = segmentOffset + segmentDepth - cameraOffset;
    }

    vec3 batchItemCenter(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        return vec3(
            fenceXOffset + xOffset,
            0,
            fenceHeight * 0.5
        );
    }

    vec2 batchItemSize(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
        float xOffsetDelta = computeSegmentDX(fenceSpacing, segmentDepth, segmentCurve);

        float visibleSideWidth = (fenceXOffset + xOffset) * fenceSpacing / (depth + fenceSpacing);
        float visibleCurvatureAdjustment = xOffsetDelta * depth / (depth + fenceSpacing);

        return vec2(
            clamp(visibleSideWidth - visibleCurvatureAdjustment + 0.1, 0.5, 10000.0),
            fenceHeight * 0.5
        );
    }
`, frag: glsl`
    #pragma glslify: roadSettings = require('./roadSettings')

    #define texelSize 0.1
    #define xGradientPrecision 0.1

    varying float depth;

    vec4 batchItemColor(vec2 facePosition) {
        vec2 surfacePosition = facePosition * vec2(1.0, fenceHeight * 0.5);
        surfacePosition += mod(-surfacePosition, texelSize);
        vec2 faceTexelPosition = surfacePosition / vec2(1.0, fenceHeight * 0.5);

        float depthRatio = clamp(depth / (depth + fenceSpacing), 0.5, 1.0); // clamp the steeper perspective
        float xGradient = depthRatio - 1.0;
        xGradient += mod(-xGradient, xGradientPrecision); // quantize up to avoid gap in wall

        float cameraHeightRatio = 1.0 / (fenceHeight * 0.5);
        float cameraHeightRatio2 = (fenceHeight - 1.0) / (fenceHeight * 0.5);

        return vec4(
            0.55 + faceTexelPosition.x * 0.3,
            0.6 + faceTexelPosition.x * 0.3,
            0.7 + faceTexelPosition.x * 0.3,
            step(facePosition.x, 0.0)
                * step(faceTexelPosition.x * xGradient * cameraHeightRatio, faceTexelPosition.y + 1.0 - texelSize * 0.5)
                * step(faceTexelPosition.x * xGradient * cameraHeightRatio2, -faceTexelPosition.y + 1.0 + texelSize * 0.5)
        );
    }
` } }, uniforms: {
    cameraOffset: regl.prop('cameraOffset')
} });

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

        varying vec2 facePosition;

        void main() {
            float fade = clamp(1.0 - facePosition.y, 0.0, 1.0);
            float fadeSq = fade * fade;

            gl_FragColor = vec4(
                0.2 + fadeSq * 0.4,
                0.6 - fadeSq * 0.4,
                0.2 + fadeSq * 0.3,
                1.0
            );
        }
    `,

    attributes: {
        position: regl.buffer([
            [ -1, -1 ],
            [ 1, -1 ],
            [ 1,  1 ],
            [ -1, 1 ]
        ])
    },

    uniforms: {
    },

    depth: { func: 'always' },

    primitive: 'triangle fan',
    count: 4
});

const cameraPosition = vec3.create();
const camera = mat4.create();

const STEP = 1 / 60.0;

const CAMERA_HEIGHT = 1.0;
const DRAW_DISTANCE = 800;

let offset = 0;
const speed = 200 / 3.6; // km/h to m/s

const aspect = canvas.width / canvas.height;
const fovX = 0.8;
const fovY = 2.0 * Math.atan(Math.tan(fovX * 0.5) / aspect);

const segmentList = [];

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
    // @todo re-add horizontal shake
    vec3.set(cameraPosition, 0, -offset, -CAMERA_HEIGHT + 0.02 * Math.cos(now * 2.31));
    mat4.translate(camera, camera, cameraPosition);

    bgCmd({
    });

    segmentRenderer(segmentList, offset, function () {
        roadCmd({
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

    fenceSegmentItemBatchRenderer(segmentList, 0, DRAW_DISTANCE, offset, camera, function (renderCommand) {
        fenceCmd({
            cameraOffset: offset
        }, renderCommand);
    });
});
