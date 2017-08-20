
vec2 computeSegmentPosition(vec2 viewPlanePosition, float viewOffset, float segmentCurvature) {
    float viewDepth = 0.01 * (viewPlanePosition.y - viewOffset);

    return vec2(
        viewPlanePosition.x + segmentCurvature * viewDepth * viewDepth,
        viewPlanePosition.y
    );
}

#pragma glslify: export(computeSegmentPosition)
