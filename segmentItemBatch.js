const glsl = require('glslify');

const CACHE_KEY_PREFIX = `__itembatch_cache${Math.round(Math.random() * 1000000)}`;
const CACHE_BATCH_VERT_KEY = CACHE_KEY_PREFIX + '_bv';
const CACHE_BATCH_FRAG_KEY = CACHE_KEY_PREFIX + '_bf';

function generateVertShader(upstream) {
    // @todo move out batchItemOffset since it should be constant anyway
    return (
        glsl`
            precision mediump float;

            #pragma glslify: computeSegmentX = require('./segment')

            uniform float segmentOffset;
            uniform float segmentLength;
            uniform vec3 segmentCurve;

            uniform int batchIndex;
            uniform float batchSize;
            uniform float batchItemSpacing;

            uniform mat4 camera;

            attribute vec3 position;

            varying vec2 facePosition;
            varying float xOffset;
            varying float segmentDepth;

            ${upstream}

            void main() {
                float segmentStartItemIndex = ceil((segmentOffset - batchItemOffset()) / batchItemSpacing);
                float nextSegmentStartItemIndex = ceil((segmentOffset + segmentLength - batchItemOffset()) / batchItemSpacing);

                float segmentItemIndex = segmentStartItemIndex + float(batchIndex) * batchSize + position.z;
                float viewPlanePositionY = segmentItemIndex * batchItemSpacing + batchItemOffset();
                segmentDepth = viewPlanePositionY - segmentOffset;
                xOffset = computeSegmentX(segmentDepth, segmentCurve);

                facePosition = position.xy;

                // allow upstream code to prep
                batchItemSetup();

                vec2 itemSize = batchItemSize();

                gl_Position = camera * vec4(
                    batchItemCenter() + vec3(
                        position.x * itemSize.x + xOffset,
                        segmentItemIndex < nextSegmentStartItemIndex ? viewPlanePositionY : -1.0,
                        position.y * itemSize.y
                    ),
                    1.0
                );
            }
        `
    );
}

function generateFragShader(upstream) {
    // @todo hard-coded main function
    return (
        glsl`
            precision mediump float;

            varying vec2 facePosition;
            varying float xOffset;
            varying float segmentDepth;

            ${upstream}
        `
    );
}

function createSegmentItemBatchRenderer(regl, itemSpacing, itemBatchSize) {
    const scopeCommand = regl({
        uniforms: {
            batchIndex: regl.prop('batchIndex'),
            batchSize: regl.prop('batchSize'),
            batchItemSpacing: regl.prop('batchItemSpacing'),

            camera: regl.prop('camera')
        },

        attributes: {
            position: regl.buffer([
                Array.apply(null, new Array(itemBatchSize)).map((noop, index) => [
                    [ -1, -1, index ],
                    [ 1, -1, index ],
                    [ -1, 1, index ],
                    [ 1,  1, index ],

                    [ 1,  1, index ],
                    [ -1, -1, (index + 1) ]
                ])
            ])
        },

        primitive: 'triangle strip',
        count: itemBatchSize * 6
    });

    const renderCommand = regl({
        context: {
            generatedVert: function (context) {
                const itemInfo = context.batchItem;

                return itemInfo[CACHE_BATCH_VERT_KEY] || (
                    itemInfo[CACHE_BATCH_VERT_KEY] = generateVertShader(itemInfo.vert)
                );
            },

            generatedFrag: function (context) {
                const itemInfo = context.batchItem;

                return itemInfo[CACHE_BATCH_FRAG_KEY] || (
                    itemInfo[CACHE_BATCH_FRAG_KEY] = generateFragShader(itemInfo.frag)
                );
            }
        },

        vert: regl.context('generatedVert'),
        frag: regl.context('generatedFrag')
    });

    return function (segmentLength, camera, cb) {
        const count = Math.ceil(segmentLength / (itemSpacing * itemBatchSize));

        for (let i = 0; i < count; i += 1) {
            scopeCommand({
                batchIndex: i,
                batchSize: itemBatchSize,
                batchItemSpacing: itemSpacing,

                camera: camera
            }, function () {
                cb(renderCommand);
            });
        }
    };
}

module.exports = {
    createSegmentItemBatchRenderer
};
