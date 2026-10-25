pub mod ipc{
 use std::{sync::Arc,marker::PhantomData};
 #[derive(Clone)]pub enum InvokeResponseBody{Json(String),Raw(Vec<u8>)}
 pub struct Channel<T>{f:Arc<dyn Fn(InvokeResponseBody)->Result<(),String>+Send+Sync>,_t:PhantomData<T>}
 impl<T> Clone for Channel<T>{fn clone(&self)->Self{Self{f:self.f.clone(),_t:PhantomData}}}
 impl<T:serde::Serialize>Channel<T>{pub fn new<F:Fn(InvokeResponseBody)->Result<(),String>+Send+Sync+'static>(f:F)->Self{Self{f:Arc::new(f),_t:PhantomData}}pub fn send(&self,value:T)->Result<(),String>{(self.f)(InvokeResponseBody::Json(serde_json::to_string(&value).map_err(|e|e.to_string())?))}}
}
