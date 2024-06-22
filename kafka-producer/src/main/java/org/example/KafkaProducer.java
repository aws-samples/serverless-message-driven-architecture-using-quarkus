package org.example;

import io.quarkus.logging.Log;
import io.smallrye.reactive.messaging.kafka.Record;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;

@ApplicationScoped
public class KafkaProducer {

    @Inject
    @Channel("orders-out")
    Emitter<Record<Integer, String>> emitter;

    public void produce(Item item) {
        Log.infof("received message item: %s description: %s\n", item.id,item.description);
        emitter.send(Record.of(item.id, item.description));
        Log.infof("produced message item: %s description: %s\n", item.id,item.description);
    }
}
