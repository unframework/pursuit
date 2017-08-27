module.exports = function parseGLSLConstants(contents) {
    const result = {};

    const regex = /#define\s+(\w+)\s+([\d.]+)/g;

    let match = null;
    while(match = regex.exec(contents)) {
        name = match[1];
        value = match[2] * 1;

        if (!Number.isNaN(value)) {
            result[name] = value;
        }
    }

    return result;
}
