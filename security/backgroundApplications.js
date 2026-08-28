const psListModule = require("ps-list");

const psList =
    psListModule.default || psListModule;


/**
 * Fetch currently running background applications
 */
async function getBackgroundApplications() {

    try {

        const processes = await psList();

        const applications = processes
            .filter(process => {

                // Ignore processes without a name
                if (!process.name) {
                    return false;
                }

                return true;

            })
            .map(process => ({

                pid: process.pid,

                name: process.name,

                cpu: process.cpu || 0,

                memory: process.memory || 0

            }));


        // ==========================================
        // PRINT ALL RUNNING APPLICATIONS
        // ==========================================

        console.log("");
        console.log("==============================================");
        console.log("     ALL RUNNING BACKGROUND APPLICATIONS");
        console.log("==============================================");

        // applications.forEach(application => {

        //     console.log(
        //         `PID: ${application.pid} | ` +
        //         `NAME: ${application.name} | ` +
        //         `CPU: ${application.cpu}% | ` +
        //         `MEMORY: ${application.memory}`
        //     );

        // });

        console.log("==============================================");
        console.log(
            `TOTAL RUNNING PROCESSES: ${applications.length}`
        );
        console.log("==============================================");
        console.log("");


        return {

            success: true,

            count: applications.length,

            applications: applications

        };

    } catch (error) {

        console.error(
            "Background application fetch error:",
            error
        );

        return {

            success: false,

            count: 0,

            applications: [],

            error: error.message

        };

    }

}


module.exports = {
    getBackgroundApplications
};