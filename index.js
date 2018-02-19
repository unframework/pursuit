const fs = require('fs');
const onecolor = require('onecolor');
const vec2 = require('gl-matrix').vec2;
const vec3 = require('gl-matrix').vec3;
const vec4 = require('gl-matrix').vec4;
const mat4 = require('gl-matrix').mat4;
const glsl = require('glslify');

const Timer = require('./Timer');
const parseGLSLConstants = require('./parseGLSLConstants');

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
        segmentLength: regl.prop('segmentLength'),
        segmentCurve: regl.prop('segmentCurve'),
        segmentOffset: regl.prop('segmentOffset'),
        camera: regl.prop('camera')
    },

    primitive: 'triangle fan',
    count: 4
});

function roadItemCommand(itemCount, itemPlacement, itemFrag) {
    return regl({
        vert: glsl`
            precision mediump float;

            #pragma glslify: roadSettings = require('./roadSettings')
            #pragma glslify: computeSegmentX = require('./segment')

            uniform float segmentOffset;
            uniform float segmentLength;
            uniform vec3 segmentCurve;
            uniform int batchIndex;
            uniform float cameraOffset;
            uniform mat4 camera;

            attribute vec3 position;

            varying vec2 facePosition;
            varying float xOffset;
            varying float depth;
            varying float segmentDepth;

            ${itemPlacement}

            void main() {
                float segmentStartItemIndex = ceil((segmentOffset - getItemOffset()) / getItemSpacing());
                float nextSegmentStartItemIndex = ceil((segmentOffset + segmentLength - getItemOffset()) / getItemSpacing());

                float segmentItemIndex = segmentStartItemIndex + float(batchIndex) * getBatchSize() + position.z;
                float viewPlanePositionY = segmentItemIndex * getItemSpacing() + getItemOffset();
                segmentDepth = viewPlanePositionY - segmentOffset;
                xOffset = computeSegmentX(segmentDepth, segmentCurve);

                facePosition = position.xy;
                depth = viewPlanePositionY - cameraOffset;

                vec2 itemSize = getItemSize();

                gl_Position = camera * vec4(
                    getItemCenter() + vec3(
                        position.x * itemSize.x + xOffset,
                        segmentItemIndex < nextSegmentStartItemIndex ? viewPlanePositionY : -1.0,
                        position.y * itemSize.y
                    ),
                    1.0
                );
            }
        `,

        frag: glsl`
            precision mediump float;

            #pragma glslify: roadSettings = require('./roadSettings')

            varying vec2 facePosition;
            varying float xOffset;
            varying float depth;
            varying float segmentDepth;

            ${itemFrag}
        `,

        attributes: {
            position: regl.buffer([
                Array.apply(null, new Array(itemCount)).map((noop, index) => [
                    [ -1, -1, index ],
                    [ 1, -1, index ],
                    [ -1, 1, index ],
                    [ 1,  1, index ],

                    [ 1,  1, index ],
                    [ -1, -1, (index + 1) ]
                ])
            ])
        },

        uniforms: {
            segmentOffset: regl.prop('segmentOffset'),
            segmentLength: regl.prop('segmentLength'),
            segmentCurve: regl.prop('segmentCurve'),
            batchIndex: regl.prop('batchIndex'),
            cameraOffset: regl.prop('cameraOffset'),
            camera: regl.prop('camera')
        },

        primitive: 'triangle strip',
        count: itemCount * 6
    });
}

postCmd = roadItemCommand(ROAD_SETTINGS.lightBatchSize, `
    float getBatchSize() {
        return lightBatchSize;
    }

    float getItemOffset() {
        return lightOffset;
    }

    float getItemSpacing() {
        return lightSpacing;
    }

    vec3 getItemCenter() {
        return vec3(
            postOffset,
            0,
            (postHeight - postRadius) * 0.5
        );
    }

    vec2 getItemSize() {
        return vec2(
            postWidth,
            postHeight - postRadius
        ) * 0.5;
    }
`, `
    void main() {
        vec2 relpos = (facePosition * vec2(0.5, 0.5) + vec2(0.5, 0.5));
        vec2 pos = relpos * vec2(postWidth, postHeight);
        pos -= mod(pos, 0.15);

        vec2 fadePos = pos / vec2(postWidth, postHeight);

        gl_FragColor = vec4(
            (0.2 * (0.15 + fadePos.y * 0.85)) * postLightColor,
            1.0
        );

        if (pos.x > postWidth) {
            discard;
        }
    }
`);

postTopCmd = roadItemCommand(ROAD_SETTINGS.lightBatchSize, `
    float getBatchSize() {
        return lightBatchSize;
    }

    float getItemOffset() {
        return lightOffset;
    }

    float getItemSpacing() {
        return lightSpacing;
    }

    vec2 getItemSize() {
        return vec2(
            postRadius + postStem,
            postRadius
        ) * 0.5;
    }

    vec3 getItemCenter() {
        vec2 size = getItemSize();

        return vec3(
            postOffset + postWidth * 0.5,
            0,
            postHeight
        ) - vec3(
            size.x,
            0,
            size.y
        );
    }
`, `
    void main() {
        vec2 relpos = (facePosition * vec2(0.5, 0.5) + vec2(0.5, 0.5));
        vec2 pos = relpos * vec2(postRadius + postStem, postRadius);
        pos -= mod(pos, 0.15);

        float fade = 1.0 - (pos.x - 0.15) / (postRadius + postStem);

        gl_FragColor = vec4(
            (0.2 - fade * 0.05) * postLightColor,
            1.0
        );

        vec2 radial = vec2(max(0.0, pos.x - postStem), pos.y);
        float radiusSq = dot(radial, radial);
        float postLightInner = postRadius - postWidth - 0.05;

        if (radiusSq > postRadius * postRadius) {
            discard;
        } else if (radiusSq < postLightInner * postLightInner) {
            discard;
        }
    }
`);

postLightCmd = roadItemCommand(ROAD_SETTINGS.lightBatchSize, `
    float getBatchSize() {
        return lightBatchSize;
    }

    float getItemOffset() {
        return lightOffset;
    }

    float getItemSpacing() {
        return lightSpacing;
    }

    vec3 getItemCenter() {
        return vec3(
            postOffset + postWidth * 0.5 - postRadius - postStem - postLightWidth * 0.5,
            0,
            postHeight - postLightHeight * 0.5
        );
    }

    vec2 getItemSize() {
        return vec2(
            postLightWidth,
            postLightHeight
        ) * 0.5;
    }
`, `
    void main() {
        gl_FragColor = vec4(
            postLightColor,
            1.0
        );
    }
`);

fenceCmd = roadItemCommand(50.0, `
    float getBatchSize() {
        return fenceBatchSize;
    }

    float getItemOffset() {
        return 6.0; // right after the light post to avoid overlapping it
    }

    float getItemSpacing() {
        return fenceSpacing;
    }

    vec3 getItemCenter() {
        return vec3(
            fenceXOffset,
            0,
            fenceHeight * 0.5
        );
    }

    vec2 getItemSize() {
        float xOffsetDelta = computeSegmentDX(fenceSpacing, segmentDepth, segmentCurve);

        float visibleSideWidth = (fenceXOffset + xOffset) * fenceSpacing / (depth + fenceSpacing);
        float visibleCurvatureAdjustment = xOffsetDelta * depth / (depth + fenceSpacing);

        return vec2(
            clamp(visibleSideWidth - visibleCurvatureAdjustment + 0.1, 0.5, 10000.0),
            fenceHeight * 0.5
        );
    }
`, `

    #define texelSize 0.1
    #define xGradientPrecision 0.1

    void main() {
        vec2 surfacePosition = facePosition * vec2(1.0, fenceHeight * 0.5);
        surfacePosition += mod(-surfacePosition, texelSize);
        vec2 faceTexelPosition = surfacePosition / vec2(1.0, fenceHeight * 0.5);

        float depthRatio = clamp(depth / (depth + fenceSpacing), 0.5, 1.0); // clamp the steeper perspective
        float xGradient = depthRatio - 1.0;
        xGradient += mod(-xGradient, xGradientPrecision); // quantize up to avoid gap in wall

        float cameraHeightRatio = 1.0 / (fenceHeight * 0.5);
        float cameraHeightRatio2 = (fenceHeight - 1.0) / (fenceHeight * 0.5);

        gl_FragColor = vec4(
            0.55 + faceTexelPosition.x * 0.3,
            0.6 + faceTexelPosition.x * 0.3,
            0.7 + faceTexelPosition.x * 0.3,
            1.0
        );

        if (facePosition.x > 0.0) {
            discard;
        } else if (faceTexelPosition.x * xGradient * cameraHeightRatio > faceTexelPosition.y + 1.0 - texelSize * 0.5) {
            discard;
        } else if (faceTexelPosition.x * xGradient * cameraHeightRatio2 > -faceTexelPosition.y + 1.0 + texelSize * 0.5) {
            discard;
        }
    }
`);

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

const tmpCurve = vec3.create();

function renderSegments(segmentList, cb) {
    let x = 0;
    let dx = 0;

    segmentList.forEach(function (segment) {
        // ensure segment vertices are not "behind" camera, otherwise perspective correction gets busted
        const segmentOffset = Math.max(offset + 3, segment.end - segment.length);

        vec3.set(
            tmpCurve,
            x,
            dx,
            segment.curvature
        );

        cb(
            segmentOffset,
            segment.end - segmentOffset,
            tmpCurve,
            segment
        );

        const depth = 0.01 * (segment.end - segmentOffset);
        x += segment.curvature * depth * depth + dx * depth;
        dx += 2 * segment.curvature * depth;
    });
}

function renderSegmentItems(itemSpacing, itemBatchSize, itemCommand, segmentList, cameraOffset, camera) {
    renderSegments(segmentList, function (
        segmentOffset,
        segmentLength,
        segmentCurve,
        segment
    ) {
        const count = Math.ceil(segmentLength / (itemSpacing * itemBatchSize));

        for (let i = 0; i < count; i += 1) {
            itemCommand({
                segmentOffset: segmentOffset,
                segmentLength: segmentLength,
                segmentCurve: segmentCurve,
                batchIndex: i,
                cameraOffset: cameraOffset,
                camera: camera
            });
        }
    });
}

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

    renderSegments(segmentList, function (
        segmentOffset,
        segmentLength,
        segmentCurve
    ) {
        roadCmd({
            segmentOffset: segmentOffset,
            segmentLength: segmentLength,
            segmentCurve: segmentCurve,
            camera: camera
        });
    });

    renderSegmentItems(ROAD_SETTINGS.lightSpacing, ROAD_SETTINGS.lightBatchSize, postCmd, segmentList, offset, camera);
    renderSegmentItems(ROAD_SETTINGS.lightSpacing, ROAD_SETTINGS.lightBatchSize, postTopCmd, segmentList, offset, camera);
    renderSegmentItems(ROAD_SETTINGS.lightSpacing, ROAD_SETTINGS.lightBatchSize, postLightCmd, segmentList, offset, camera);
    renderSegmentItems(ROAD_SETTINGS.fenceSpacing, ROAD_SETTINGS.fenceBatchSize, fenceCmd, segmentList, offset, camera);
});
