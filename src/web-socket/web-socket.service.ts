
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from 'socket.io'

@WebSocketGateway({
    path: '/ws',
    cors: {
        origin: '*',
    }
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    handleConnection(client: Socket) {
        console.log(`Client connected ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        console.log(`Client disconnected ${client.id}`);
    }

    @SubscribeMessage('events')
    handleMessage(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
        client.broadcast.emit('events', data)
    }
}

