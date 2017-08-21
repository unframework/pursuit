
vec2 computeSegmentPosition(vec2 viewPlanePosition, float startOffset, float segmentCurvature, float segmentX, float segmentDX) {
    float viewDepth = 0.01 * (viewPlanePosition.y - startOffset);

    return vec2(
        viewPlanePosition.x + segmentCurvature * viewDepth * viewDepth + segmentDX * viewDepth + segmentX,
        viewPlanePosition.y
    );
}

#pragma glslify: export(computeSegmentPosition)
