package org.example;

import io.quarkus.logging.Log;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/order")
public class OrderResource {
    @Inject
    KafkaProducer producer;

    @Path("/{id:\\d+}/{description}")
    @GET
    public String produce(int id, String description){
        Item i = new Item(id, description);
        Log.infof("Incoming Info Message id: %s Description: %s",id,description);
        producer.produce(i);
        return "Success";
    }

}
