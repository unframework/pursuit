const vec3 = require('gl-matrix').vec3;

const tmpCurve = vec3.create();

// walk segment list in view and compute visible curve parameters
// ensuring no part of the segment is "behind" camera (otherwise perspective correction gets busted)
function withEachSegmentVisibleCurve(segmentList, offset, cb) {
    let x = 0;
    let dx = 0;

    segmentList.forEach(function (segment) {
        const segmentOffset = Math.max(offset + 3, segment.end - segment.length);
        const segmentLength = segment.end - segmentOffset;

        // safety check
        if (segmentLength < 0) {
            return;
        }

        vec3.set(
            tmpCurve,
            x,
            dx,
            segment.curvature
        );

        cb(
            segmentOffset,
            segmentLength,
            tmpCurve
        );

        // calculate curve for next segment
        const depth = 0.01 * segmentLength;
        x += segment.curvature * depth * depth + dx * depth;
        dx += 2 * segment.curvature * depth;
    });
}

module.exports = {
    withEachSegmentVisibleCurve
};
