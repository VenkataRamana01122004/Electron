const os = require("os");
const process = require("process");

async function getSystemInformation() {
    try {
        const cpus = os.cpus();
        let username = null;

        try {
            username = os.userInfo().username;
        } catch (error) {
            console.error("Unable to get username:", error.message);
        }

        return {
            platform: process.platform,
            architecture: process.arch,
            operatingSystem: os.platform(),
            release: os.release(),
            hostname: os.hostname(),
            cpuCount: cpus.length,
            cpuModel: cpus[0]?.model || null,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            usedMemory: os.totalmem() - os.freemem(),
            username,
            electronVersion: process.versions.electron,
            chromeVersion: process.versions.chrome,
            nodeVersion: process.versions.node,
            processId: process.pid,
            timestamp: Date.now()
        };
    } catch (error) {
        console.error("System information error:", error);
        throw error;
    }
}

module.exports = { getSystemInformation };