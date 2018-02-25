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

function createFenceCommand(isLeft, perspectiveDepth) {
    const perspectiveDepthRatio = perspectiveDepth / (perspectiveDepth + ROAD_SETTINGS.fenceSpacing);

    return regl({ context: { batchItem: { vert: glsl`
        #pragma glslify: roadSettings = require('./roadSettings')
        #pragma glslify: computeSegmentX = require('./segment', computeSegmentDX=computeSegmentDX)

        #define hFlip ${isLeft ? '-1.0' : '1.0'}

        uniform float cameraOffset;

        varying float xOffset;
        varying float depth;

        void batchItemSetup(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
            xOffset = computeSegmentX(segmentDepth, segmentCurve);
            depth = segmentOffset + segmentDepth - cameraOffset;
        }

        vec3 batchItemCenter(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
            return vec3(
                hFlip * fenceXOffset + xOffset,
                0,
                fenceHeight * 0.5
            );
        }

        vec2 batchItemSize(float segmentOffset, vec3 segmentCurve, float segmentDepth) {
            float xOffsetDelta = computeSegmentDX(fenceSpacing, segmentDepth, segmentCurve);

            float visibleSideWidth = hFlip * (hFlip * fenceXOffset + xOffset) * fenceSpacing / (depth + fenceSpacing);
            float visibleCurvatureAdjustment = hFlip * xOffsetDelta * depth / (depth + fenceSpacing);

            return vec2(
                clamp(visibleSideWidth - visibleCurvatureAdjustment + 0.1, 0.5, 10000.0),
                fenceHeight * 0.5
            );
        }
    `, frag: glsl`
        #pragma glslify: roadSettings = require('./roadSettings')

        #define texelSize 0.1
        #define depthRatio ${perspectiveDepthRatio}
        #define hFlip ${isLeft ? '-1.0' : '1.0'}

        vec4 batchItemColor(vec2 facePosition) {
            vec2 surfacePosition = facePosition * vec2(hFlip * 1.0, fenceHeight * 0.5);
            surfacePosition += mod(-surfacePosition, texelSize);
            vec2 faceTexelPosition = surfacePosition / vec2(1.0, fenceHeight * 0.5);

            float xGradient = depthRatio - 1.0;

            float cameraHeightRatio = 1.0 / (fenceHeight * 0.5);
            float cameraHeightRatio2 = (fenceHeight - 1.0) / (fenceHeight * 0.5);

            return vec4(
                0.55 + faceTexelPosition.x * 0.3,
                0.6 + faceTexelPosition.x * 0.3,
                0.7 + faceTexelPosition.x * 0.3,
                step(faceTexelPosition.x, 0.0)
                    * step(faceTexelPosition.x * xGradient * cameraHeightRatio, faceTexelPosition.y + 1.0 - texelSize * 0.5)
                    * step(faceTexelPosition.x * xGradient * cameraHeightRatio2, -faceTexelPosition.y + 1.0 + texelSize * 0.5)
            );
        }
    ` } }, uniforms: {
        cameraOffset: regl.prop('cameraOffset')
    } });
}

// no need for sprite distance closer than 40 because the added transition "pop" is too close and not worth the precision
const fenceL40Cmd = createFenceCommand(true, 40);
const fenceL80Cmd = createFenceCommand(true, 80);
const fenceL160Cmd = createFenceCommand(true, 160);
const fenceL1000Cmd = createFenceCommand(true, 1000);
const fenceR40Cmd = createFenceCommand(false, 40);
const fenceR80Cmd = createFenceCommand(false, 80);
const fenceR160Cmd = createFenceCommand(false, 160);
const fenceR1000Cmd = createFenceCommand(false, 1000);

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

const bgTopColor = vec3.fromValues(...onecolor('#005555').toJSON().slice(1));
const bgBottomColor = vec3.fromValues(...onecolor('#ff5555').toJSON().slice(1));
const roadColor = vec3.fromValues(...onecolor('#000055').toJSON().slice(1));
const roadHighlightColor = vec3.fromValues(...onecolor('#aa5500').toJSON().slice(1));
const markerColor = vec3.fromValues(...onecolor('#005555').toJSON().slice(1));
const markerHighlightColor = vec3.fromValues(...onecolor('#ffffff').toJSON().slice(1));

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
        topColor: bgTopColor,
        bottomColor: bgBottomColor,
    });

    segmentRenderer(segmentList, offset, function () {
        roadCmd({
            roadColor: roadColor,
            roadHighlightColor: roadHighlightColor,
            markerColor: markerColor,
            markerHighlightColor: markerHighlightColor,
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

    fenceSegmentItemBatchRenderer(segmentList, 0, 40, offset, camera, function (renderCommand) {
        fenceL40Cmd({
            cameraOffset: offset
        }, renderCommand);
    });

    fenceSegmentItemBatchRenderer(segmentList, 40, 80, offset, camera, function (renderCommand) {
        fenceL80Cmd({
            cameraOffset: offset
        }, renderCommand);
    });

    fenceSegmentItemBatchRenderer(segmentList, 80, 160, offset, camera, function (renderCommand) {
        fenceL160Cmd({
            cameraOffset: offset
        }, renderCommand);
    });

    fenceSegmentItemBatchRenderer(segmentList, 160, DRAW_DISTANCE, offset, camera, function (renderCommand) {
        fenceL1000Cmd({
            cameraOffset: offset
        }, renderCommand);
    });

    fenceSegmentItemBatchRenderer(segmentList, 0, 40, offset, camera, function (renderCommand) {
        fenceR40Cmd({
            cameraOffset: offset
        }, renderCommand);
    });

    fenceSegmentItemBatchRenderer(segmentList, 40, 80, offset, camera, function (renderCommand) {
        fenceR80Cmd({
            cameraOffset: offset
        }, renderCommand);
    });

    fenceSegmentItemBatchRenderer(segmentList, 80, 160, offset, camera, function (renderCommand) {
        fenceR160Cmd({
            cameraOffset: offset
        }, renderCommand);
    });

    fenceSegmentItemBatchRenderer(segmentList, 160, DRAW_DISTANCE, offset, camera, function (renderCommand) {
        fenceR1000Cmd({
            cameraOffset: offset
        }, renderCommand);
    });
});
