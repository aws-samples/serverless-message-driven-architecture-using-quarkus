package org.example;

import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.reactive.messaging.Incoming;
import io.smallrye.reactive.messaging.kafka.Record;

import io.quarkus.logging.Log;

@ApplicationScoped
public class KafkaConsumer {

    @Incoming("orders-in")
    public void consume(Record<Integer, String> record) {
        int id = record.key(); //Message key that is item id
        String description = record.value(); //item description
        Log.infof("\nConsumed Message - Order id: %s Description: %s",id ,description);
    }

}
