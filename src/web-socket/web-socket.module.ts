import { Module } from '@nestjs/common';
import { WebsocketGateway } from './web-socket.service';

@Module({
  providers: [WebsocketGateway]
})
export class WebSocketModule { }
