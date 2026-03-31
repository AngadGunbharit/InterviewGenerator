import { useState } from "react";

interface ListGroupProps {
  items: string[];
  heading: string;
  //function which takrs item:string => void
  onSelectItem: (item: string) => void;
}
function ListGroup({ items, heading, onSelectItem }: ListGroupProps) {
  //Event Handler
  //const handleClick = (event: MouseEvent) => console.log(event);

  //hook
  const [selectedIndex, setselectedIndex] = useState(-1);

  return (
    <>
      <h1> {heading}</h1>

      {items.length === 0 && <p> No item found</p>}

      <ul className="list-group">
        {items.map((item, index) => (
          <li
            className={
              selectedIndex === index
                ? "list-group-item active"
                : "list-group-item"
            }
            key={item}
            onClick={() => {
              setselectedIndex(index);
              onSelectItem(item);
            }}
          >
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}
export default ListGroup;
