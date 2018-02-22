const glsl = require('glslify');

const CACHE_KEY_PREFIX = `__itembatch_cache${Math.round(Math.random() * 1000000)}`;
const CACHE_BATCH_VERT_KEY = CACHE_KEY_PREFIX + '_bv';
const CACHE_BATCH_FRAG_KEY = CACHE_KEY_PREFIX + '_bf';

function generateVertShader(upstream) {
    return (
        glsl`
            precision mediump float;

            // upstream code first, to discourage use of internals
            ${upstream}

            uniform float segmentOffset;
            uniform float segmentLength;
            uniform vec3 segmentCurve;

            uniform int batchIndex;
            uniform float batchSize;
            uniform float batchItemOffset;
            uniform float batchItemSpacing;

            uniform float visibleMinDepth;
            uniform float visibleMaxDepth;

            uniform mat4 camera;

            attribute vec3 position;

            varying vec2 facePosition;

            void main() {
                float segmentStartItemIndex = ceil((segmentOffset - batchItemOffset) / batchItemSpacing);
                float nextSegmentStartItemIndex = ceil((segmentOffset + segmentLength - batchItemOffset) / batchItemSpacing);

                float segmentItemIndex = segmentStartItemIndex + float(batchIndex) * batchSize + position.z;
                float viewPlanePositionY = segmentItemIndex * batchItemSpacing + batchItemOffset;
                float segmentDepth = viewPlanePositionY - segmentOffset;

                facePosition = position.xy;

                // allow upstream code to prep
                batchItemSetup(segmentOffset, segmentCurve, segmentDepth);

                vec2 itemSize = batchItemSize(segmentOffset, segmentCurve, segmentDepth);

                gl_Position = camera * vec4(
                    batchItemCenter(segmentOffset, segmentCurve, segmentDepth) + vec3(
                        position.x * itemSize.x,
                        viewPlanePositionY
                            * step(visibleMinDepth, viewPlanePositionY) // hide if too close
                            * step(viewPlanePositionY, visibleMaxDepth) // hide if too far
                            * step(segmentItemIndex, nextSegmentStartItemIndex - 0.5), // stop before next segment (exclusive range)
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

            ${upstream}

            varying vec2 facePosition;

            void main() {
                gl_FragColor = batchItemColor(facePosition);

                // hard alpha (discarding after setting frag color, makes a difference in some renderers)
                if (gl_FragColor.a < 1.0) {
                    discard;
                }
            }
        `
    );
}

function createSegmentItemBatchRenderer(regl, segmentRenderer, itemBatchSize, itemSpacing, itemOffset) {
    const scopeCommand = regl({
        uniforms: {
            batchIndex: regl.prop('batchIndex'),
            batchSize: regl.prop('batchSize'),
            batchItemSpacing: regl.prop('batchItemSpacing'),
            batchItemOffset: regl.prop('batchItemOffset'),

            visibleMinDepth: regl.prop('visibleMinDepth'),
            visibleMaxDepth: regl.prop('visibleMaxDepth'),

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

    return function (segmentList, minDepth, maxDepth, offset, camera, cb) {
        const itemBatchLength = itemSpacing * itemBatchSize;
        const visibleMinDepth = offset + minDepth;
        const visibleMaxDepth = offset + maxDepth;

        segmentRenderer(segmentList, offset, function (segmentOffset, segmentLength) {
            // weed out wholesale if out of range
            if (segmentOffset + segmentLength < visibleMinDepth) {
                return;
            }

            if (segmentOffset > visibleMaxDepth) {
                return;
            }

            // repeat batch for segment length
            const count = Math.ceil(segmentLength / itemBatchLength);

            for (let i = 0; i < count; i += 1) {
                scopeCommand({
                    batchIndex: i,
                    batchSize: itemBatchSize,
                    batchItemSpacing: itemSpacing,
                    batchItemOffset: itemOffset,

                    visibleMinDepth: visibleMinDepth,
                    visibleMaxDepth: visibleMaxDepth,

                    camera: camera
                }, function () {
                    cb(renderCommand);
                });
            }
        });
    };
}

module.exports = {
    createSegmentItemBatchRenderer
};
