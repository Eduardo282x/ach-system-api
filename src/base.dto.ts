import { Transform } from "class-transformer";
import { IsDate } from "class-validator";

export class DateRangeDTO {
    @IsDate()
    @Transform(({ value }) => new Date(value)) // Transform string to Date
    startDate!: Date;
    @IsDate()
    @Transform(({ value }) => new Date(value)) // Transform string to Date
    endDate!: Date;
}