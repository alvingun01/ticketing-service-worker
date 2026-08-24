import { UserRole } from '../enums/user-role.enum';

export class CreateUserDto {
    email: string;
    name: string;
    role?: UserRole;
}
