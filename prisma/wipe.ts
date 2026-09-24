import type { PrismaClient } from "@prisma/client";

/** Delete every row in every table (children first). Used by the sample-data loader and "start fresh". */
export async function wipeAllData(db: PrismaClient) {
  await db.$transaction([
    db.auditLog.deleteMany(),
    db.storedFile.deleteMany(),
    db.schedulingOverride.deleteMany(),
    db.conditionReport.deleteMany(),
    db.projectPhoto.deleteMany(),
    db.projectNote.deleteMany(),
    db.projectStatusHistory.deleteMany(),
    db.equipmentAssignment.deleteMany(),
    db.assignment.deleteMany(),
    db.scheduleBlock.deleteMany(),
    db.projectRequiredEquipment.deleteMany(),
    db.projectRequiredSkill.deleteMany(),
    db.project.deleteMany(),
    db.jobType.deleteMany(),
    db.customer.deleteMany(),
    db.weatherForecast.deleteMany(),
    db.equipmentDowntime.deleteMany(),
    db.equipment.deleteMany(),
    db.timeOff.deleteMany(),
    db.availability.deleteMany(),
    db.employeeSkill.deleteMany(),
    db.user.deleteMany(),
    db.employee.deleteMany(),
    db.skill.deleteMany(),
    db.location.deleteMany(),
    db.appSetting.deleteMany(),
  ]);
}

/** Common starting lists for a striping company; editable in the app. */
export const DEFAULT_SKILLS = ["Line Striping", "Layout", "Thermoplastic", "CDL Driver", "Sealcoating", "Traffic Control"];
export const DEFAULT_JOB_TYPES = ["Parking lot restripe", "New layout", "Thermoplastic", "Sealcoating", "ADA / signage"];
