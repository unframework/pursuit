const onecolor = require('onecolor');
const vec2 = require('gl-matrix').vec2;
const vec3 = require('gl-matrix').vec3;
const vec4 = require('gl-matrix').vec4;
const mat4 = require('gl-matrix').mat4;
const glsl = require('glslify');

const Timer = require('./Timer');

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
    extensions: [
        'EXT_frag_depth'
    ],
    canvas: canvas
});

roadCmd = regl({
    vert: glsl`
        precision mediump float;

        uniform mat4 camera;
        uniform float drawDistance;
        attribute vec2 position;

        varying vec2 facePosition;

        void main() {
            facePosition = position;

            gl_Position = camera * vec4(
                position.x * 4.75,
                position.y * drawDistance,
                0,
                1.0
            );
        }
    `,

    frag: glsl`
        precision mediump float;

        #pragma glslify: dither = require('glsl-dither/8x8')
        #pragma glslify: cnoise2 = require('glsl-noise/classic/2d')

        uniform float drawDistance;
        uniform float drawOffset;

        varying vec2 facePosition;

        void main() {
            vec2 roadPos = vec2(
                facePosition.x * 4.75,
                facePosition.y * drawDistance + drawOffset
            );

            vec2 asphaltPos = roadPos * vec2(20.0, 10.0);

            float wearNoise = cnoise2(roadPos / vec2(4.3, 12.9));
            float asphaltNoise = cnoise2(vec2(
                asphaltPos.x - mod(asphaltPos.x, 0.5),
                asphaltPos.y - mod(asphaltPos.y, 0.5)
            ));

            float asphaltSpec = clamp((asphaltNoise - 0.8) / 0.2, 0.0, 1.0);
            float asphaltCrack = clamp(-0.6 - asphaltNoise, 0.0, 1.0) / 0.4;

            float lanePos = mod((facePosition.x + 1.0) * 1.6 - 0.1, 1.0);
            float side = 1.0 - step(0.02, lanePos) * step(lanePos, 0.98);

            vec3 color = side * mod(roadPos.y, 4.0) > 2.0
                ? vec3(0.25, 0.25, 0.27)
                : vec3(0.16, 0.16, 0.18) * (1.0 - asphaltCrack * 0.3 + asphaltSpec * 0.8);

            gl_FragColor = vec4(color * (0.88 + wearNoise * 0.12), 1.0);
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
        aspectRatio: regl.prop('aspectRatio'),
        drawDistance: regl.prop('drawDistance'),
        drawOffset: regl.prop('drawOffset'),
        camera: regl.prop('camera')
    },

    primitive: 'triangle fan',
    count: 4
});

fogCmd = regl({
    vert: glsl`
        precision mediump float;

        attribute vec2 position;
        varying vec2 facePosition;

        void main() {
            facePosition = position;
            gl_Position = vec4(position, 0, 1.0);
        }
    `,

    frag: glsl`
        #extension GL_EXT_frag_depth: require
        precision mediump float;

        #pragma glslify: snoise3 = require('glsl-noise/simplex/3d')
        #pragma glslify: ditherLimit8x8 = require('./ditherLimit8x8')

        uniform float time;

        varying vec2 facePosition;

        void main() {
            float limit = ditherLimit8x8(gl_FragCoord.xy);
            float noise = snoise3(vec3(facePosition, time * 0.1));

            gl_FragColor = vec4(
                0.05 + noise * 0.02,
                0.07 + noise * 0.02 + 0.025 * facePosition.y,
                0.07 + noise * 0.02 + 0.05 * facePosition.y,
                1.0
            );
            gl_FragDepthEXT = 1.0 - 0.025 * limit * (1.0 + 0.5 * noise);
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
        time: regl.prop('time')
    },

    primitive: 'triangle fan',
    count: 4
});

const cameraPosition = vec3.create();
const camera = mat4.create();

const STEP = 1 / 60.0;

const CAMERA_HEIGHT = 2.5;
const DRAW_CYCLE = 100;
const DRAW_DISTANCE = DRAW_CYCLE * 4;

let offset = 0;
const speed = 90 / 3.6; // km/h to m/s

const timer = new Timer(STEP, 0, function () {
    offset += speed * STEP;
}, function (now) {
    mat4.perspective(camera, 0.6, canvas.width / canvas.height, 1, DRAW_DISTANCE - DRAW_CYCLE);

    // pitch
    mat4.rotateX(camera, camera, -Math.PI / 2);

    // camera shake and offset
    vec3.set(cameraPosition, 0.02 * Math.sin(now * 3.43), 0, -CAMERA_HEIGHT + 0.02 * Math.cos(now * 2.31));
    mat4.translate(camera, camera, cameraPosition);

    fogCmd({
        time: now
    });

    roadCmd({
        aspectRatio: aspectRatio,
        drawDistance: DRAW_DISTANCE,
        drawOffset: offset,
        camera: camera
    });
});
