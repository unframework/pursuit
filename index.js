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
    canvas: canvas
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
        #pragma glslify: cnoise2 = require('glsl-noise/classic/2d')
        #pragma glslify: computeSegmentX = require('./segment')
        #pragma glslify: ditherLimit8x8 = require('./ditherLimit8x8')

        uniform float segmentOffset;
        uniform float segmentCurvature;
        uniform float segmentX;
        uniform float segmentDX;

        varying vec2 viewPlanePosition;

        void main() {
            float roadHalfWidth = (roadLaneWidth * 3.0 + roadShoulderWidth * 2.0) * 0.5;

            vec2 segmentPosition = vec2(
                viewPlanePosition.x - computeSegmentX(viewPlanePosition.y, segmentOffset, segmentCurvature, segmentX, segmentDX),
                viewPlanePosition.y
            );

            float lightPos = 1.5 - 0.5 / (0.5 + abs((mod(segmentPosition.y - lightOffset, lightSpacing) / lightSpacing) - 0.5));

            float wearNoise = cnoise2(segmentPosition / vec2(8.3, 17.9));

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

            float lightness = (0.95 + wearNoise * 0.05) * (notMarker < 1.0
                ? (0.3 + lightPos * 0.7)
                : (0.2 + lightPos * 0.8)
            );
            float limit = ditherLimit8x8(gl_FragCoord.xy);

            float steppedLightness = 0.7 + step(0.75 + 0.1 * limit, lightness) * 0.3 + step(0.9 + 0.2 * limit, lightness) * 0.9;

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
        segmentCurvature: regl.prop('segmentCurvature'),
        segmentOffset: regl.prop('segmentOffset'),
        segmentX: regl.prop('segmentX'),
        segmentDX: regl.prop('segmentDX'),
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
            uniform float segmentX;
            uniform float segmentDX;
            uniform float segmentCurvature;
            uniform float segmentFullLength;
            uniform int batchIndex;
            uniform mat4 camera;

            attribute vec3 position;

            varying vec2 facePosition;

            ${itemPlacement}

            void main() {
                float segmentStartItemIndex = ceil((segmentOffset - getItemOffset()) / getItemSpacing());
                float nextSegmentStartItemIndex = ceil((segmentOffset + segmentLength - getItemOffset()) / getItemSpacing());

                float segmentItemIndex = segmentStartItemIndex + float(batchIndex) * getBatchSize() + position.z;
                float viewPlanePositionY = segmentItemIndex * getItemSpacing() + getItemOffset();
                float xOffset = computeSegmentX(viewPlanePositionY, segmentOffset, segmentCurvature, segmentX, segmentDX);

                facePosition = position.xy;

                vec2 size = getItemSize();

                gl_Position = camera * vec4(
                    getItemCenter() + vec3(
                        position.x * size.x + xOffset,
                        segmentItemIndex < nextSegmentStartItemIndex ? viewPlanePositionY : -1.0,
                        position.y * size.y
                    ),
                    1.0
                );
            }
        `,

        frag: glsl`
            precision mediump float;

            #pragma glslify: roadSettings = require('./roadSettings')

            varying vec2 facePosition;

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
            segmentX: regl.prop('segmentX'),
            segmentDX: regl.prop('segmentDX'),
            segmentCurvature: regl.prop('segmentCurvature'),
            segmentFullLength: regl.prop('segmentFullLength'),
            batchIndex: regl.prop('batchIndex'),
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
        float roadHalfWidth = (roadLaneWidth * 3.0 + roadShoulderWidth * 2.0) * 0.5;

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
        float roadHalfWidth = (roadLaneWidth * 3.0 + roadShoulderWidth * 2.0) * 0.5;
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
        float roadHalfWidth = (roadLaneWidth * 3.0 + roadShoulderWidth * 2.0) * 0.5;

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

signCmd = roadItemCommand(1, `
    float getBatchSize() {
        return 1.0;
    }

    float getItemOffset() {
        return 80.0;
    }

    float getItemSpacing() {
        return 1000.0;
    }

    vec2 getItemSize() {
        return vec2(
            signWidth,
            signHeight
        ) * 0.5;
    }

    vec3 getItemCenter() {
        return vec3(
            -7.8,
            0,
            0.5 + signHeight * 0.5
        );
    }
`, `
    void main() {
        vec2 relpos = (facePosition * vec2(0.5, 0.5) + vec2(0.5, 0.5));
        vec2 pos = relpos * vec2(signWidth, signHeight);
        pos -= mod(pos, 0.075);

        vec2 radial = vec2(
            max(0.0, signRadius - pos.x) + max(0.0, pos.x + 0.075 + signRadius - signWidth),
            max(0.0, signRadius - pos.y) + max(0.0, pos.y + 0.075 + signRadius - signHeight)
        );

        float radiusSq = dot(radial, radial);
        float postLightInner = signRadius - 0.15;

        gl_FragColor = radiusSq < postLightInner * postLightInner + 0.01
            ? vec4(
                0.2, 0.35, 0.3,
                1.0
            )
            : vec4(
                0.7, 0.6, 0.73,
                1.0
            );

        if (radiusSq > signRadius * signRadius + 0.01) {
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

function renderSegments(segmentList, cb) {
    let x = 0;
    let dx = 0;

    segmentList.forEach(function (segment) {
        // ensure segment vertices are not "behind" camera, otherwise perspective correction gets busted
        const segmentOffset = Math.max(offset + 3, segment.end - segment.length);

        cb(
            segmentOffset,
            segment.end - segmentOffset,
            x,
            dx,
            segment.curvature,
            segment
        );

        const depth = 0.01 * (segment.end - segmentOffset);
        x += segment.curvature * depth * depth + dx * depth;
        dx += 2 * segment.curvature * depth;
    });
}

function renderLights(segmentList, cb) {
    renderSegments(segmentList, function (
        segmentOffset,
        segmentLength,
        segmentX,
        segmentDX,
        segmentCurvature,
        segment
    ) {
        const count = Math.ceil(segmentLength / (ROAD_SETTINGS.lightSpacing * ROAD_SETTINGS.lightBatchSize));

        for (let i = 0; i < count; i += 1) {
            cb(
                segmentOffset,
                segmentLength,
                segmentX,
                segmentDX,
                segmentCurvature,
                segment,
                i
            );
        }
    });
}

const cameraPosition = vec3.create();
const camera = mat4.create();

const STEP = 1 / 60.0;

const CAMERA_HEIGHT = 2.5;
const DRAW_DISTANCE = 800;

let offset = 0;
const speed = 90 / 3.6; // km/h to m/s

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
    mat4.perspective(camera, 0.6, canvas.width / canvas.height, 1, DRAW_DISTANCE);

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
        segmentX,
        segmentDX,
        segmentCurvature
    ) {
        roadCmd({
            segmentOffset: segmentOffset,
            segmentLength: segmentLength,
            segmentCurvature: segmentCurvature,
            segmentX: segmentX,
            segmentDX: segmentDX,
            camera: camera
        });
    });

    renderLights(segmentList, function (
        segmentOffset,
        segmentLength,
        segmentX,
        segmentDX,
        segmentCurvature,
        segment,
        i
    ) {
        postCmd({
            segmentOffset: segmentOffset,
            segmentLength: segmentLength,
            segmentCurvature: segmentCurvature,
            segmentX: segmentX,
            segmentDX: segmentDX,
            segmentFullLength: segment.length,
            batchIndex: i,
            camera: camera
        });
    });

    renderLights(segmentList, function (
        segmentOffset,
        segmentLength,
        segmentX,
        segmentDX,
        segmentCurvature,
        segment,
        i
    ) {
        postTopCmd({
            segmentOffset: segmentOffset,
            segmentLength: segmentLength,
            segmentCurvature: segmentCurvature,
            segmentX: segmentX,
            segmentDX: segmentDX,
            segmentFullLength: segment.length,
            batchIndex: i,
            camera: camera
        });
    });

    renderLights(segmentList, function (
        segmentOffset,
        segmentLength,
        segmentX,
        segmentDX,
        segmentCurvature,
        segment,
        i
    ) {
        postLightCmd({
            segmentOffset: segmentOffset,
            segmentLength: segmentLength,
            segmentCurvature: segmentCurvature,
            segmentX: segmentX,
            segmentDX: segmentDX,
            segmentFullLength: segment.length,
            batchIndex: i,
            camera: camera
        });
    });

    renderLights(segmentList, function (
        segmentOffset,
        segmentLength,
        segmentX,
        segmentDX,
        segmentCurvature,
        segment,
        i
    ) {
        signCmd({
            segmentOffset: segmentOffset,
            segmentLength: segmentLength,
            segmentCurvature: segmentCurvature,
            segmentX: segmentX,
            segmentDX: segmentDX,
            segmentFullLength: segment.length,
            batchIndex: i,
            camera: camera
        });
    });
});
