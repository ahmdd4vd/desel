import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
/** HTML stays text. Only http(s) sources are navigable; no embedded remote pixels. */
export function ChatMarkdown({text}:{text:string}){
 return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
  a:({href,children})=>href&&/^https?:\/\//i.test(href)?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
  img:({alt})=><span className="chat-image-omitted">[Gambar: {alt||'lihat sumber'}]</span>,
  pre:({children})=><pre tabIndex={0}>{children}</pre>,
  table:({children})=><div className="chat-table"><table>{children}</table></div>
 }}>{text}</ReactMarkdown></div>;
}
