import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Decorator đánh dấu route API là công khai không yêu cầu xác thực JWT */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
